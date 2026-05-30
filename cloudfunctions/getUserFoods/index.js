// cloudfunctions/getUserFoods/index.js
// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = event.openid || wxContext.OPENID

  try {
    console.log('=== [getUserFoods] START ===')
    console.log('当前用户openid:', openid)

    // === Step 1: 查找当前用户是否在共享冰箱组中 ===
    const shareFridgeRes = await db.collection('shared_fridges')
      .where({
        $or: [
          { ownerOpenId: openid },
          { 'members.openId': openid }
        ]
      })
      .limit(1)
      .get()

    console.log('shared_fridges查询结果数:', shareFridgeRes.data ? shareFridgeRes.data.length : 0)

    // 默认只查询用户自己的食材
    let queryOpenids = [openid]

    if (shareFridgeRes.data && shareFridgeRes.data.length > 0) {
      const shareFridge = shareFridgeRes.data[0]
      queryOpenids = (shareFridge.members || []).map(m => m.openId)
      console.log(`👥 [getUserFoods] 共享冰箱组, 成员数=${queryOpenids.length}, 列表:`, JSON.stringify(queryOpenids))
    }

    console.log('最终queryOpenids:', JSON.stringify(queryOpenids))

    // === Step 2: 先不带 status 过滤查一下，看底层数据 ===
    const rawRes = await db.collection('fridge_items')
      .where({
        _openid: _.in(queryOpenids),
      })
      .limit(100)
      .get()

    console.log('[getUserFoods] 无status过滤查到:', rawRes.data ? rawRes.data.length : 0, '条')
    if (rawRes.data && rawRes.data.length > 0) {
      console.log('[getUserFoods] 原始样例:', JSON.stringify(rawRes.data[0]))
      console.log('[getUserFoods] 所有status值:', JSON.stringify(rawRes.data.map(d => d.status)))
    }

    // === Step 3: 带 status 过滤正式查询 ===
    const res = await db.collection('fridge_items')
      .where({
        _openid: _.in(queryOpenids),
        // 过滤已消耗的，保留其他所有可用状态
        status: db.RegExp({ regexp: '^(?!consumed$)', options: 'i' })
      })
      .get()

    const allItems = res.data || []
    console.log('[getUserFoods] 带status过滤最终返回:', allItems.length, '条')

    return {
      success: true,
      data: allItems,
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