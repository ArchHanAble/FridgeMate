const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取评论列表 — 批量获取多个做菜历史记录的评论
 * 
 * 入参：
 *   recordIds - 做菜历史记录 ID 数组
 * 
 * 流程：
 *   1. 批量查询 cooking_history_comments 表
 *   2. 汇总所有评论者的 openid
 *   3. 批量查询 users 表获取头像和昵称
 *   4. 按 recordId 分组返回评论（含用户信息）
 * 
 * 返回：
 *   commentMap: { [recordId]: Comment[] }
 */
exports.main = async (event, context) => {
  const { recordIds } = event

  if (!recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
    return { success: true, commentMap: {} }
  }

  try {
    // === Step 1: 批量查询评论 ===
    // 微信云开发 where + in 一次最多 20 条，需分批
    const BATCH_SIZE = 20
    let allComments = []

    for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
      const batch = recordIds.slice(i, i + BATCH_SIZE)
      const res = await db.collection('cooking_history_comments')
        .where({
          recordId: db.command.in(batch),
        })
        .orderBy('createdAt', 'asc')
        .get()
      allComments = allComments.concat(res.data || [])
    }

    if (allComments.length === 0) {
      return { success: true, commentMap: {} }
    }

    // === Step 2: 汇总所有评论者的 openid（去重） ===
    const openidSet = new Set()
    allComments.forEach(c => {
      if (c.openid) openidSet.add(c.openid)
    })
    const uniqueOpenids = Array.from(openidSet)

    // === Step 3: 批量查询用户信息 ===
    const userMap = {}
    const USER_BATCH_SIZE = 20

    for (let i = 0; i < uniqueOpenids.length; i += USER_BATCH_SIZE) {
      const batch = uniqueOpenids.slice(i, i + USER_BATCH_SIZE)
      const userRes = await db.collection('users')
        .where({
          _openid: db.command.in(batch),
        })
        .get()

      if (userRes.data) {
        userRes.data.forEach(u => {
          userMap[u._openid] = {
            nickName: u.nickName || '',
            avatarUrl: u.avatarUrl || '',
          }
        })
      }
    }

    // === Step 4: 组装数据，按 recordId 分组 ===
    const commentsWithUsers = allComments.map(c => ({
      _id: c._id,
      recordId: c.recordId,
      openid: c.openid,
      content: c.content,
      createdAt: c.createdAt,
      nickName: userMap[c.openid]?.nickName || '',
      avatarUrl: userMap[c.openid]?.avatarUrl || '',
    }))

    // 按 recordId 分组
    const commentMap = {}
    commentsWithUsers.forEach(c => {
      if (!commentMap[c.recordId]) {
        commentMap[c.recordId] = []
      }
      commentMap[c.recordId].push(c)
    })

    return { success: true, commentMap }

  } catch (err) {
    console.error('❌ [getComments] 异常:', err.message || err)
    return { success: false, errMsg: err.message || '获取评论失败', commentMap: {} }
  }
}
