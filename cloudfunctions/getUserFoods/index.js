// cloudfunctions/getUserFood/index.js
// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
  
    // 宽松查询：优先 fresh/expiring，如果为空则查全部（兼容各种状态值）
    const res = await db.collection('fridge_items')
    .where({
      _openid: openid,
    })
    // .limit(100)
    .get()
    const allItems = res.data || []
    // 过滤掉已过期/已消耗的，保留其他所有可用状态
    return {
      success: true,
      data: allItems.filter(item => item.status !== 'expired' && item.status !== 'consumed' ),
      message: '获取用户食材成功'
    }
  } catch (error) {
    console.error('获取用户食材失败：', error)
    return {
      success: false,
      data: [],
      message: '获取用户食材失败'
    }
  }
}