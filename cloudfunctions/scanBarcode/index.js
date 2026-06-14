// cloudfunctions/scanBarcode/index.js
const cloud = require('wx-server-sdk')
const CryptoJS = require('crypto-js')
const request = require('request')
const querystring = require('querystring')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 扫码识别 - 查询条形码对应的商品信息
 * 
 * 查询优先级：
 *   1. 本地品牌库缓存（brand_shelf_life 集合）
 *   2. 腾讯云API市场 - 商品条形码信息查询（需订阅该服务获取 API Key）
 *   3. 常见商品内置映射表（兜底）
 */

// ========== 腾讯云API市场配置 ==========
// ⚠️ 重要：请先完成以下步骤获取正式密钥：
//   1. 打开 https://market.cloud.tencent.com/products/20577 登录腾讯云
//   2. 点击"0元/50次"规格，完成订阅（免费，首次需要手机验证）
//   3. 订阅成功后，进入控制台 https://console.cloud.tencent.com/apiMarket/manage
//   4. 找到"已购服务"→"商品条形码信息查询"→"密钥管理"
//   5. 复制这里的 secretId 和 secretKey 填入下方
const TENCENT_CLOUD_CONFIG = {
  apiUrl: 'http://ap-guangzhou.cloudmarket-apigw.com/service-8lp6ruw0/getBarcode',
  secretID :'xZ9xKWHcsP7n0jSD',
  secretKey:'gb0v8clKAFSQjv64eq0UI1SgL6hYrT0E'
}
exports.main = async (event, context) => {
  const { barcode } = event

  if (!barcode) {
    return { success: false, errMsg: '条码不能为空' }
  }

  // 标准化条码（去掉空格和前后缀）
  const normalizedBarcode = String(barcode).trim().replace(/\s/g, '')
  console.log(`📷 查询条码: ${normalizedBarcode}`)

  try {
    // === Step 1: 从本地品牌库查找 ===
    try {
      const localRes = await db.collection('brand_shelf_life')
        .where(_.or([
          { barcode: normalizedBarcode },
          { fullName: db.RegExp({ regexp: normalizedBarcode, options: 'i' }) }
        ]))
        .limit(1)
        .get()

      if (localRes.data && localRes.data.length > 0) {
        const match = localRes.data[0]
        console.log(`✅ 本地库命中: ${match.fullName || match.productName}`)
        return buildSuccessResult(match, 'local')
      }
    } catch (dbErr) {
      console.warn('⚠️ 本地数据库查询失败，继续外部查询:', dbErr.message)
    }

    // === Step 2: 查询腾讯云API市场 - 商品条形码信息查询 ===
    let cloudResult = null
    try {
      cloudResult = await queryTencentCloudBarcode(normalizedBarcode)
    } catch (tcErr) {
      console.log('腾讯云API市场查询失败:', tcErr.message)
    }

    if (cloudResult) {
      // 缓存到本地品牌库
      await cacheToLocal(normalizedBarcode, cloudResult, 'tencentcloud')
      return buildSuccessResult(cloudResult, 'tencentcloud')
    }


    // === 全部未匹配 ===
    return {
      success: false,
      product: {
        name: '未识别的商品',
        barcode: normalizedBarcode,
        message: '该条码暂未被收录，请手动填写信息',
      },
      fromCache: false,
      errMsg: `未找到条码 ${normalizedBarcode} 的商品信息`,
    }

  } catch (err) {
    console.error('❌ 扫码解析异常:', err)
    return { success: false, errMsg: err.message || '扫码服务暂时不可用' }
  }
}

// ==================== 结果构建 ====================

function buildSuccessResult(data, source) {
  return {
    success: true,
    product: {
      name: data.fullName || data.productName || data.name || '',
      brand: data.brandName || data.brand || '',
      barcode: data.barcode || '',
      shelfLifeDays: data.shelfLifeDays || estimateShelfLife(data.category),
      category: mapCategory(data.category),
      imageUrl: data.imageUrl || data.image || '',
      storageCondition: data.storageCondition || '',
      source: source,
    },
    fromCache: source === 'local',
  }
}

async function cacheToLocal(barcode, productData, source) {
  try {
    await db.collection('brand_shelf_life').add({
      data: {
        barcode,
        brandName: productData.brand || productData.brandName || '',
        productName: productData.name || '',
        fullName: productData.fullName || productData.name || '',
        shelfLifeDays: productData.shelfLifeDays || estimateShelfLife(productData.category),
        storageCondition: productData.storageCondition || '',
        category: mapCategory(productData.category),
        isVerified: false,
        source: source,
        lastUpdated: new Date(),
        imageUrl: productData.imageUrl || productData.image || null,
      }
    })
    console.log(`📦 条码 ${barcode} 已缓存到本地`)
  } catch (e) {
    console.warn('缓存写入失败:', e.message)
  }
}

// ==================== 外部API：腾讯云API市场 - 商品条形码查询 ====================

/**
 * 查询腾讯云API市场 - 商品条形码信息
 * 使用 HMAC-SHA1 签名认证，GET 请求（参考腾讯云API市场官方示例）
 * 
 * 文档参考：
 * - 服务地址：http://ap-guangzhou.cloudmarket-apigw.com/service-8lp6ruw0/getBarcode
 * - 认证方式：secretId + HMAC-SHA1 签名（使用 crypto-js）
 * - 请求方法：GET（使用 request 库）
 * - 查询参数：Code=条形码（大写 C）
 */
async function queryTencentCloudBarcode(barcode) {
  const { secretID, secretKey, apiUrl } = TENCENT_CLOUD_CONFIG

  // 生成签名（严格按腾讯云API市场官方示例）
  const datetime = (new Date()).toGMTString()
  const uuId = randomUUID()
  const signStr = 'x-date: ' + datetime
  const sign = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA1(signStr, secretKey))
  const auth = '{"id": "' + secretID + '", "x-date": "' + datetime + '", "signature": "' + sign + '"}'

  // 请求方法 - GET
  const method = 'GET'
  const headers = {
    'request-id': uuId,
    'Authorization': auth,
  }
  // 查询参数（大写 Code）
  const queryParams = {
    Code: barcode,
  }

  // url拼接
  let url = apiUrl
  if (Object.keys(queryParams).length > 0) {
    url += '?' + querystring.stringify(queryParams)
  }
  console.log(`📤 请求API: ${url}`)

  const options = {
    url: url,
    timeout: 8000,
    method: method,
    headers: headers,
  }

  const res = await new Promise((resolve, reject) => {
    request(options, function (error, response, body) {
      if (error !== null) {
        reject(error)
        return
      }
      try {
        const json = JSON.parse(body)
        resolve(json)
      } catch (e) {
        reject(new Error('JSON解析失败: ' + String(body).substring(0, 200)))
      }
    })
  })

  // ==================== 解析API返回数据 ====================
  if (!res) return null

  // 打印原始响应以便调试
  console.log('📥 API原始响应:', JSON.stringify(res).slice(0, 500))

  // 判断是否成功：该 API 返回 status="200" + Barcode/ItemName 等顶层字段
  const isSuccess = res.status === '200' || res.status === 200 || res.message === '查询成功！'
  const hasNameField = res.ItemName || res.itemName || res.name || res.productName

  if (!isSuccess && !hasNameField) {
    const errMsg = res.message || res.msg || res.err_msg || ''
    console.log('❌ 腾讯云API返回错误:', errMsg, '| 完整响应:', JSON.stringify(res).slice(0, 300))
    if (errMsg.indexOf('密钥') !== -1 || errMsg.indexOf('签名') !== -1 || errMsg.indexOf('匹配') !== -1) {
      console.error('⚠️ 密钥配置错误！请按以下步骤操作：')
      console.error('   1. 打开 https://console.cloud.tencent.com/apiMarket/manage 登录腾讯云')
      console.error('   2. 在"已购服务"中找到 "商品条形码信息查询"')
      console.error('   3. 点击"密钥管理"，获取正确的 secretId 和 secretKey')
      console.error('   4. 将获取到的值填入 index.js 的 TENCENT_CLOUD_CONFIG 配置中')
    }
    return null
  }

  // 该API返回的商品字段直接在顶层
  const productData = res

  // 字段映射（适配该 API 的字段名）
  const name = productData.ItemName || productData.itemName || productData.productName || productData.product_name || productData.name || ''
  if (!name || name.trim().length < 1) {
    console.log('腾讯云API返回数据中未找到商品名称')
    return null
  }

  const brand = productData.BrandName || productData.brandName || productData.brand_name || productData.brand || ''
  const fullName = (name + ' ' + (productData.ItemSpecification || '')).trim()
  // 图片字段可能是数组，取第一张
  let imgUrl = ''
  if (Array.isArray(productData.Image) && productData.Image.length > 0) {
    imgUrl = typeof productData.Image[0] === 'string' ? productData.Image[0] : productData.Image[0].url || productData.Image[0].Imageurl || ''
  } else if (productData.imageUrl) {
    imgUrl = productData.imageUrl
  }
  const category = productData.ItemClassName || productData.ItemClassCode || productData.gpcname || productData.gpc || ''
  const firmName = productData.FirmName || ''
  const spec = productData.ItemSpecification || ''

  // 根据商品名/分类推断内部分类和保质期
  const productNameForInfer = name + ' ' + fullName + ' ' + category
  const internalCategory = inferCategoryFromProduct(productNameForInfer)
  const shelfLife = estimateShelfLife(internalCategory)

  console.log(`🔍 腾讯云API匹配成功: ${name.trim()} | 品牌: ${brand} | 规格: ${spec}`)

  return {
    name: name.trim(),
    fullName: fullName.trim(),
    brand: brand ? brand.trim() : '',
    barcode: productData.Barcode || productData.barcode || '',
    image: imgUrl,
    category: internalCategory,
    shelfLifeDays: shelfLife,
    ItemSpecification: spec,
    FirmName: firmName,
  }
}

/**
 * 生成 UUID v4
 */
function randomUUID() {
  const hexDigits = '0123456789abcdef'
  let uuid = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-'
    } else if (i === 14) {
      uuid += '4'
    } else if (i === 19) {
      uuid += hexDigits[(Math.floor(Math.random() * 4) + 8)]
    } else {
      uuid += hexDigits[Math.floor(Math.random() * 16)]
    }
  }
  return uuid
}



// ==================== 分类与保质期推断 ====================

/**
 * 根据商品名称/描述推断内部分类
 */
function inferCategoryFromProduct(productText) {
  const catStr = productText.toLowerCase()
  
  const rules = [
    { keywords: ['牛奶', '乳制品', '酸奶', '奶酪', '奶油', 'milk', 'yogurt', 'cheese', 'cream', '奶粉', '纯奶'], result: 'dairy' },
    { keywords: ['饮料', '水', '果汁', '茶', '咖啡', '汽水', '啤酒', '矿泉水', '牛奶饮品', 'beverage', 'drink', 'juice', 'soda', '可乐', '雪碧'], result: 'beverage' },
    { keywords: ['肉', '猪肉', '牛肉', '鸡肉', '羊肉', '香肠', '火腿', '腊肉', 'meat', 'pork', 'beef', 'chicken', 'sausage', 'ham'], result: 'meat' },
    { keywords: ['水果', '苹果', '香蕉', '橙子', '葡萄', '草莓', 'fruit', 'apple', 'banana', 'orange', 'grape', 'strawberry'], result: 'fruit' },
    { keywords: ['蔬菜', '卷心菜', '菠菜', '番茄', '土豆', '洋葱', '胡萝卜', 'vegetable', 'cabbage', 'spinach', 'tomato', 'potato', 'onion', 'carrot', '白菜', '青菜'], result: 'vegetable' },
    { keywords: ['海鲜', '鱼', '虾', '蟹', 'seafood', 'fish', 'shrimp', 'crab'], result: 'meat' },
    { keywords: ['酱', '油', '醋', '酱油', '盐', '调料', '调味', '番茄酱', 'sauce', 'oil', 'vinegar', 'soy', 'salt', 'spice', 'seasoning', 'ketchup', '蚝油', '料酒'], result: 'condiment' },
  ]
  
  for (const rule of rules) {
    if (rule.keywords.some(kw => catStr.includes(kw))) {
      return rule.result
    }
  }
  return 'other'
}

/**
 * 兜底：根据内部分类估算保质期天数
 */
function estimateShelfLife(category) {
  const estimates = {
    dairy: 180, beverage: 180, meat: 14, fruit: 7, vegetable: 5, condiment: 365, other: 90,
  }
  return estimates[category] || 90
}

/**
 * 映射外部分类到内部分类体系
 */
function mapCategory(externalCat) {
  const mapping = {
    'dairy': 'dairy', '乳制品': 'dairy', '奶': 'dairy', 'milk': 'dairy',
    'beverage': 'beverage', '饮料': 'beverage', 'drink': 'beverage', '水': 'beverage',
    'meat': 'meat', '肉': 'meat', '肉制品': 'meat', 'pork': 'meat', 'fish': 'meat',
    'vegetable': 'vegetable', '蔬': 'vegetable', '蔬菜': 'vegetable', '菜': 'vegetable',
    'fruit': 'fruit', '果': 'fruit', '水果': 'fruit',
    'condiment': 'condiment', '调料': 'condiment', '调味品': 'condiment', '酱': 'condiment', 'oil': 'condiment',
  }
  
  if (mapping[externalCat]) return mapping[externalCat]
  if (externalCat) {
    for (const [key, val] of Object.entries(mapping)) {
      if ((externalCat || '').includes(key)) return val
    }
  }
  return 'other'
}
