// cloudfunctions/getCookHistory/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 获取用户的做菜历史记录 + 统计概览
 *
 * 返回：
 * - records: 做菜记录列表（含菜谱图片）
 * - stats: 统计数据（本月次数、累计节省、最常做）
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  console.log(`📜 查询做菜历史, openid=${openid}`)

  try {
    // === 1. 获取所有做菜记录（按时间倒序，最近50条）===
    const res = await db.collection('cooking_history')
      .where({ _openid: openid })
      .orderBy('cookedAt', 'desc')
      .limit(50)
      .get()

    const rawRecords = res.data || []

    if (!rawRecords.length) {
      return {
        success: true,
        records: [],
        stats: { monthCount: 0, totalSaved: 0, favoriteDish: '--' },
        errMsg: '',
      }
    }

    // === 2. 补充每条记录的菜谱图片信息 ===
    // cooking_history 中存的是 recipeId + recipeName，
    // 需要补上 image 字段用于前端展示

    const now = new Date()
    let monthCount = 0
    const recipeFreq = {}       // 菜谱出现频率统计
    const allRecipeIds = []     // 收集所有需要查图片的 ID

    for (const r of rawRecords) {
      // 本月计数
      const cookedDate = new Date(r.cookedAt)
      if (cookedDate.getFullYear() === now.getFullYear() &&
          cookedDate.getMonth() === now.getMonth()) {
        monthCount++
      }
      // 频率统计
      const name = r.recipeName || '未知菜品'
      recipeFreq[name] = (recipeFreq[name] || 0) + 1
      // 收集 recipeId（去重后批量查图片）
      if (r.recipeId && !allRecipeIds.includes(r.recipeId)) {
        allRecipeIds.push(r.recipeId)
      }
    }

    // 找最常做的菜名
    let favoriteDish = '--'
    let maxFreq = 0
    for (const [name, count] of Object.entries(recipeFreq)) {
      if ((count as number) > maxFreq) {
        maxFreq = count as number
        favoriteDish = name
      }
    }

    // 构建图片缓存映射（recipeId → imageUrl）
    const imageMap = {}
    
    // 尝试从 recipes 集合中获取菜谱图片
    if (allRecipeIds.length > 0) {
      try {
        // 分批查询（每次最多 20 条 in 查询）
        const BATCH_SIZE = 20
        for (let i = 0; i < allRecipeIds.length; i += BATCH_SIZE) {
          const batch = allRecipeIds.slice(i, i + BATCH_SIZE)
          
          // 先尝试查 recipes 集合
          const recipeRes = await db.collection('recipes')
            .where({ _id: _.in(batch) })
            .field({ _id: true, name: true, image: true })
            .get()

          for (const doc of recipeRes.data || []) {
            if (doc.image) {
              imageMap[doc._id] = doc.image
            }
          }
        }
      } catch (imgErr) {
        console.warn('获取菜谱图片失败:', imgErr.message)
        // 不影响主流程
      }
    }

    // === 3. 组装最终记录格式 ===
    const records = rawRecords.map((r, idx) => {
      const cookedDate = new Date(r.cookedAt)
      const y = cookedDate.getFullYear()
      const m = String(cookedDate.getMonth() + 1).padStart(2, '0')
      const d = String(cookedDate.getDate()).padStart(2, '0')
      const h = String(cookedDate.getHours()).padStart(2, '0')
      const min = String(cookedDate.getMinutes()).padStart(2, '0')

      return {
        _id: r._id || `history_${idx}`,
        recipeId: r.recipeId || '',
        name: r.recipeName || '未知菜品',
        image: imageMap[r.recipeId] || '',   // 有图就展示，无图为空
        cookedAt: new Date(r.cookedAt).getTime(),
        dateStr: `${y}-${m}-${d}`,
        timeStr: `${h}:${min}`,
        ingredients: r.consumedIngredients || [],
      }
    })

    // 累计节省金额（每道菜约 ¥4 外卖差价 × 总次数）
    const totalSaved = rawRecords.length * 4

    return {
      success: true,
      records,
      stats: {
        monthCount,
        totalSaved,
        favoriteDish,
      },
      errMsg: '',
    }

  } catch (err) {
    console.error('❌ 获取做菜历史失败:', err)
    return { success: false, errMsg: err.message || '服务器内部错误' }
  }
}
