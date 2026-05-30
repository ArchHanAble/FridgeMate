// cloudfunctions/addFoodItem/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 添加食材到冰箱
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const {
      name, brand, category, location,
      quantity, unit,
      productionDate, expiryDate, shelfLifeDays,
      note, barcode, source = 'manual',
      image,
    } = event

    // 必填校验
    if (!name || !name.trim()) {
      return { success: false, errMsg: '食材名称不能为空' }
    }
    if (!category) {
      return { success: false, errMsg: '请选择分类' }
    }

    // === 去重检查：同一冰箱组不能有重复名称的食材 ===
    const trimmedName = name.trim()

    // 查找用户所在的共享组
    let checkOpenids = [openid]
    try {
      const fridgeRes = await db.collection('shared_fridges')
        .where({
          $or: [
            { ownerOpenId: openid },
            { 'members.openId': openid }
          ]
        })
        .limit(1)
        .get()

      if (fridgeRes.data && fridgeRes.data.length > 0) {
        const fridge = fridgeRes.data[0]
        checkOpenids = (fridge.members || []).map(m => m.openId)
      }
    } catch (e) {
      // 集合不存在等情况，仅检查用户自己的食材
      console.warn('共享组查询失败，仅检查个人食材:', e.message)
    }

    // 查询同组内是否存在同名且未消耗的食材
    const dupRes = await db.collection('fridge_items')
      .where({
        _openid: _.in(checkOpenids),
        name: trimmedName,
        status: db.RegExp({ regexp: '^(?!consumed$)', options: 'i' })
      })
      .count()

    if (dupRes.total > 0) {
      return { success: false, errMsg: `冰箱中已存在「${trimmedName}」，请勿重复添加` }
    }

    // 如果有barcode，尝试从品牌库获取保质期信息
    let finalShelfLifeDays = shelfLifeDays
    let finalExpiryDate = expiryDate
    let brandInfo = null

    if (barcode && (!shelfLifeDays || !expiryDate)) {
      try {
        const brandRes = await db.collection('brand_shelf_life')
          .where({ barcode: barcode })
          .limit(1)
          .get()

        if (brandRes.data && brandRes.data.length > 0) {
          brandInfo = brandRes.data[0]
          if (!finalShelfLifeDays) finalShelfLifeDays = brandInfo.shelfLifeDays
        }
      } catch (e) {
        console.log('品牌库查询失败，使用手动数据')
      }
    }

    // 自动计算过期日期（如果只有生产日期和保质期天数）
    if (productionDate && finalShelfLifeDays && !finalExpiryDate) {
      const prod = new Date(productionDate)
      prod.setDate(prod.getDate() + Number(finalShelfLifeDays))
      finalExpiryDate = prod.toISOString().split('T')[0]
    }

    // 计算初始状态
    let status = 'fresh'
    if (finalExpiryDate) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expiry = new Date(finalExpiryDate)
      expiry.setHours(0, 0, 0, 0)
      const diffMs = expiry.getTime() - today.getTime()
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays < 0) status = 'expired'
      else if (diffDays <= 3) status = 'expiring'
    }

    // 构建写入数据
    const dataToSave = {
      _openid: openid,
      name: trimmedName,
      brand: (brand || '').trim(),
      category,
      location: location || 'fridge',
      quantity: Number(quantity) || 1,
      unit: unit || '个',
      productionDate: productionDate || null,
      expiryDate: finalExpiryDate || null,
      shelfLifeDays: Number(finalShelfLifeDays) || 0,
      note: (note || '').trim(),
      barcode: barcode || null,
      image: image || null,
      source,
      isAutoExpiry: !!brandInfo,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // 写入数据库
    const res = await db.collection('fridge_items').add({ data: dataToSave })

    console.log(`✅ 食材添加成功: ${name}, id=${res._id}`)

    return {
      success: true,
      _id: res._id,
      status,
      expiryDate: finalExpiryDate,
      errMsg: '',
    }
  } catch (err) {
    console.error('❌ 添加食材失败:', err)
    return { success: false, errMsg: err.message || '服务器内部错误' }
  }
}
