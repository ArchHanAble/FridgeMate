const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 管理食材 — 支持跨共享组成员操作
 * action: 'getDetail' | 'consume' | 'delete'
 *
 * consume: 扣减食材库存，数量归零时自动标记为已消耗
 *   event.amount: 要扣减的数量（可选，不传则直接标记消耗）
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = event.openid || wxContext.OPENID
  const { action, itemId } = event

  if (!action || !itemId) {
    return { success: false, errMsg: '缺少 action 或 itemId' }
  }

  console.log(`🔧 [manageFoodItem] action=${action}, openid=${openid}, itemId=${itemId}`)

  try {
    // === Step 1: 获取食材文档 ===
    const itemRes = await db.collection('fridge_items').doc(itemId).get()
    if (!itemRes.data) {
      return { success: false, errMsg: '食材不存在' }
    }

    const item = itemRes.data

    // === Step 2: 权限校验 — 检查用户是否有权操作 ===
    // 2a. 如果是自己的食材，直接通过
    if (item._openid === openid) {
      // 有权操作
    } else {
      // 2b. 检查是否和食材主人在同一个共享冰箱组
      const fridgeRes = await db.collection('shared_fridges')
        .where({
          $or: [
            { ownerOpenId: openid },
            { 'members.openId': openid }
          ]
        })
        .limit(1)
        .get()

      if (!fridgeRes.data || fridgeRes.data.length === 0) {
        return { success: false, errMsg: '你没有权限操作该食材' }
      }

      const fridge = fridgeRes.data[0]
      const memberOpenids = (fridge.members || []).map(m => m.openId)

      // 检查食材主人是否在同一组
      if (!memberOpenids.includes(item._openid)) {
        return { success: false, errMsg: '你和该食材主人不在同一个共享组' }
      }
    }

    // === Step 3: 执行操作 ===
    switch (action) {
      case 'getDetail':
        console.log(`✅ [manageFoodItem] 返回详情: ${itemId}`)
        return { success: true, data: item, errMsg: '' }

      case 'consume': {
        const { amount } = event
        const currentQty = item.quantity || 0
        const newQty = amount ? Math.max(0, currentQty - amount) : 0

        if (newQty <= 0) {
          // 数量归零，标记为已消耗
          await db.collection('fridge_items').doc(itemId).update({
            data: { status: 'consumed', quantity: 0, updatedAt: new Date() }
          })
        } else {
          // 数量减少但还有剩余
          await db.collection('fridge_items').doc(itemId).update({
            data: { quantity: newQty, updatedAt: new Date() }
          })
        }
        console.log(`✅ [manageFoodItem] 扣减完成: ${itemId}, ${currentQty} → ${newQty}`)
        return {
          success: true,
          before: currentQty,
          after: newQty,
          status: newQty <= 0 ? 'consumed' : 'reduced',
          errMsg: '',
        }
      }

      case 'delete':
        await db.collection('fridge_items').doc(itemId).remove()
        console.log(`✅ [manageFoodItem] 已删除: ${itemId}`)
        return { success: true, message: '已删除', errMsg: '' }

      default:
        return { success: false, errMsg: `未知操作: ${action}` }
    }

  } catch (err) {
    console.error('❌ [manageFoodItem] 异常:', err.message || err)
    return { success: false, errMsg: err.message || '操作失败' }
  }
}
