const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取用户信息 — 根据 openid 查询 users 表，返回头像与昵称
 * 
 * 入参：openid (可选，不传则获取当前用户)
 * 返回：{ nickName, avatarUrl }
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const targetOpenid = event.openid || wxContext.OPENID

  if (!targetOpenid) {
    return { success: false, errMsg: '无法获取用户标识' }
  }

  try {
    const userRes = await db.collection('users')
      .where({ _openid: targetOpenid })
      .limit(1)
      .get()

    if (userRes.data && userRes.data.length > 0) {
      const user = userRes.data[0]
      return {
        success: true,
        user: {
          openid: targetOpenid,
          nickName: user.nickName || '',
          avatarUrl: user.avatarUrl || '',
        },
      }
    }

    // 用户记录不存在时返回空信息
    return {
      success: true,
      user: {
        openid: targetOpenid,
        nickName: '',
        avatarUrl: '',
      },
    }

  } catch (err) {
    console.error('❌ [getUser] 异常:', err.message || err)
    return { success: false, errMsg: err.message || '查询失败' }
  }
}
