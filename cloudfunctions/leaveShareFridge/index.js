const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 退出共享冰箱 — 成员主动退出
 * 注意：owner 不能退出，应使用 dissolveFridge 解散
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  console.log(`🚪 [leaveFridge] 开始, openid=${openid}`)

  try {
    // === Step 1: 查找用户所在的共享组 ===
    const fridgeRes = await db.collection('shared_fridges')
      .where({
        $or: [
          { ownerOpenId: openid },
          { 'members.openId': openid },
        ],
      })
      .limit(1)
      .get()

    if (!fridgeRes.data || fridgeRes.data.length === 0) {
      return { success: false, errMsg: '未找到共享组' }
    }

    const fridge = fridgeRes.data[0]

    // === Step 2: owner 不允许退出，必须解散 ===
    if (fridge.ownerOpenId === openid) {
      return { success: false, errMsg: '管理员不能退出冰箱，请使用解散功能' }
    }

    // === Step 3: 从 members 中移除当前用户 ===
    const updatedMembers = (fridge.members || []).filter(m => m.openId !== openid)

    if (updatedMembers.length === (fridge.members || []).length) {
      return { success: false, errMsg: '你不是该冰箱的成员' }
    }

    await db.collection('shared_fridges').doc(fridge._id).update({
      data: {
        members: updatedMembers,
        updatedAt: new Date()
      }
    })

    console.log(`✅ [leaveFridge] 用户已退出: ${openid}`)

    return {
      success: true,
      message: '已退出冰箱',
      errMsg: '',
    }

  } catch (err) {
    console.error('❌ [leaveFridge] 异常:', err.message || err)
    return { success: false, errMsg: err.message || '退出失败' }
  }
}
