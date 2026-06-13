// cloudfunctions/uploadToQiniu/index.js
const cloud = require('wx-server-sdk')
const qiniu = require('qiniu')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// ==================== 七牛云配置 ====================
// ⚠️ 请在以下填入你的七牛云账号信息
// 可以在七牛云控制台 -> 个人中心 -> 密钥管理 中获取
const QINIU = {
  accessKey: process.env.QINIU_ACCESS_KEY || '06An8ihe61_H783pCrHzU031c6qrqGeKZ7V7B2Zl',
  secretKey: process.env.QINIU_SECRET_KEY || 'IkcCoqVLat2snp1AMHOTD080vsy2Z8jBV4QK5v7D',
  bucket: process.env.QINIU_BUCKET || 'fridgemate-bucket',       // 存储空间名称
  domain: process.env.QINIU_DOMAIN || 'http://tggs17lum.hn-bkt.clouddn.com',   // 完整访问地址 --改掉了https为http
}

/**
 * 上传图片到七牛云存储
 *
 * @param {string} event.imageBase64 - 图片的 base64 编码（不含前缀）
 * @param {string} event.fileName    - 文件名（可选，默认自动生成）
 * @param {string} event.folder      - 存储目录（可选，默认 recipes）
 *
 * @returns {{ success: boolean, url: string, key: string, errMsg: string }}
 */
exports.main = async (event, context) => {
  try {
    const { imageBase64, fileName, folder = 'recipes' } = event

    if (!imageBase64 || !imageBase64.trim()) {
      return { success: false, url: '', key: '', errMsg: '缺少图片数据' }
    }

    // 生成唯一文件名 — 修复重复后缀 bug
    const ext = (fileName && fileName.includes('.')) ? fileName.split('.').pop() : 'jpg'
    // 提取纯基础文件名（去掉已有扩展名，避免 .${ext} 拼接后重复）
    let baseName = ''
    if (fileName) {
      baseName = fileName.replace(/[^a-zA-Z0-9._-]/g, '')        // 过滤特殊字符
      baseName = baseName.replace(new RegExp(`\\.${ext}$`, 'i'), '')  // 去掉已存在的 .jpg/.png 等
    }
    if (!baseName) {
      baseName = Date.now() + '_' + Math.random().toString(36).slice(2, 8)
    }
    const key = `${folder}/${baseName}.${ext}`


    // 构造上传凭证
    const mac = new qiniu.auth.digest.Mac(QINIU.accessKey, QINIU.secretKey)
    const putPolicy = new qiniu.rs.PutPolicy({ scope: QINIU.bucket })
    const uploadToken = putPolicy.uploadToken(mac)

    // 构造上传配置
    const config = new qiniu.conf.Config()
    // 华南
    config.zone = qiniu.zone.Zone_zn0
    const formUploader = new qiniu.form_up.FormUploader(config)
    const putExtra = new qiniu.form_up.PutExtra()

    // 将 base64 转为 Buffer 并上传
    const imageBuffer = Buffer.from(imageBase64, 'base64')

    return new Promise((resolve, reject) => {
      formUploader.put(uploadToken, key, imageBuffer, putExtra, (respErr, respBody, respInfo) => {
        if (respErr) {
          console.error('[uploadToQiniu] 七牛上传错误:', respErr)
          resolve({
            success: false,
            url: '',
            key: '',
            errMsg: respErr.message || '上传失败',
          })
          return
        }

        if (respInfo.statusCode === 200) {
          // 拼接完整访问地址
          const url = `${QINIU.domain}/${key}`
          console.log(`[uploadToQiniu] 上传成功: ${url}`)
          resolve({
            success: true,
            url,
            key,
            errMsg: '',
          })
        } else {
          console.error('[uploadToQiniu] 七牛返回异常:', respInfo.statusCode, respBody)
          resolve({
            success: false,
            url: '',
            key: '',
            errMsg: `上传失败(${respInfo.statusCode}): ${JSON.stringify(respBody)}`,
          })
        }
      })
    })
  } catch (err) {
    console.error('[uploadToQiniu] 异常:', err)
    return { success: false, url: '', key: '', errMsg: err.message || '服务器内部错误' }
  }
}
