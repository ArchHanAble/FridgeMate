// cloudfunctions/getCookHistory/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 获取用户的做菜历史记录（分页） + 统计概览
 *
 * 入参：
 *   - page:      页码，默认 1
 *   - pageSize:  每页条数，默认 5
 *   - keyword:   搜索关键词（按菜谱名称模糊匹配），可选
 *
 * 返回：
 *   - records:   当前页做菜记录列表（含菜谱图片）
 *   - stats:     统计数据（本月次数、累计节省、最常做）—— 始终基于全量数据
 *   - total:     匹配条件的总记录数
 *   - page:      当前页码
 *   - pageSize:  每页条数
 *   - hasMore:   是否还有更多页
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const { page = 1, pageSize = 5, keyword = '' } = event

  console.log(`📜 查询做菜历史, openid=${openid}, page=${page}, pageSize=${pageSize}, keyword="${keyword}"`)

  try {
    // === 0. 查找共享冰箱组，获取同组所有成员 openid ===
    let queryOpenids = [openid]
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
        queryOpenids = (fridge.members || []).map(m => m.openId)
        console.log(`👥 [getCookHistory] 共享组做菜历史查询, 成员数=${queryOpenids.length}`)
      }
    } catch (e) {
      console.warn('共享组查询失败，仅查询个人做菜历史:', e.message)
    }

    const baseCondition = { _openid: _.in(queryOpenids) }

    // === 1. 计算统计数据（基于全量数据，不受分页/搜索影响）===
    let monthCount = 0
    let favoriteDish = '--'
    let totalSaved = 0

    try {
      const allRes = await db.collection('cooking_history')
        .where(baseCondition)
        .get()

      const allRecords = allRes.data || []

      if (allRecords.length > 0) {
        const now = new Date()
        const recipeFreq = {}

        for (const r of allRecords) {
          const cookedDate = new Date(r.cookedAt)
          if (cookedDate.getFullYear() === now.getFullYear() &&
              cookedDate.getMonth() === now.getMonth()) {
            monthCount++
          }
          const name = r.recipeName || '未知菜品'
          recipeFreq[name] = (recipeFreq[name] || 0) + 1
        }

        let maxFreq = 0
        for (const [name, count] of Object.entries(recipeFreq)) {
          if (count > maxFreq) {
            maxFreq = count
            favoriteDish = name
          }
        }

        totalSaved = allRecords.length * 4
      }
    } catch (statsErr) {
      console.warn('统计数据计算失败:', statsErr.message)
    }

    const stats = { monthCount, totalSaved, favoriteDish }

    // === 2. 构建带搜索条件的分页查询 ===
    let queryCondition = { ...baseCondition }
    if (keyword && keyword.trim()) {
      const escapedKeyword = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      queryCondition.recipeName = db.RegExp({
        regexp: escapedKeyword,
        options: 'i'
      })
    }

    // 获取匹配条件的总记录数
    const countRes = await db.collection('cooking_history')
      .where(queryCondition)
      .count()

    const total = countRes.total

    if (total === 0) {
      return {
        success: true,
        records: [],
        stats,
        total: 0,
        page,
        pageSize,
        hasMore: false,
        errMsg: '',
      }
    }

    // 分页查询当前页记录
    const res = await db.collection('cooking_history')
      .where(queryCondition)
      .orderBy('cookedAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    const rawRecords = res.data || []

    // === 3. 补充当前页记录的菜谱图片信息 ===
    const allRecipeIds = []
    for (const r of rawRecords) {
      if (r.recipeId && !allRecipeIds.includes(r.recipeId)) {
        allRecipeIds.push(r.recipeId)
      }
    }

    const imageMap = {}
    if (allRecipeIds.length > 0) {
      try {
        const BATCH_SIZE = 20
        for (let i = 0; i < allRecipeIds.length; i += BATCH_SIZE) {
          const batch = allRecipeIds.slice(i, i + BATCH_SIZE)
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
      }
    }

    // === 4. 组装最终记录格式 ===
    const records = rawRecords.map((r, idx) => {
      const cookedDate = new Date(r.cookedAt)
      const y = cookedDate.getFullYear()
      const m = String(cookedDate.getMonth() + 1).padStart(2, '0')
      const d = String(cookedDate.getDate()).padStart(2, '0')

      let consumedIngredients = []

      if (Array.isArray(r.consumedIngredients)) {
        consumedIngredients = r.consumedIngredients.map(item => {
          if (typeof item === 'string') {
            return { name: item, amount: 0, unit: '' }
          }
          return {
            name: item.name || '',
            amount: item.amount || 0,
            unit: item.unit || ''
          }
        }).filter(item => item.name)
      }

      if (Array.isArray(r.missingInFridge)) {
        const existingNames = new Set(consumedIngredients.map(item => item.name))
        r.missingInFridge.forEach(item => {
          let name = ''
          let amount = 0
          let unit = ''
          if (typeof item === 'string') {
            name = item
          } else if (item && typeof item === 'object') {
            name = item.name || ''
            amount = item.amount || 0
            unit = item.unit || ''
          }
          if (!name) return
          if (existingNames.has(name)) {
            console.log(`⚠️ 食材 "${name}" 已存在于 consumedIngredients 中，跳过 missingInFridge 中的重复项`)
          } else {
            consumedIngredients.push({ name, amount, unit })
            existingNames.add(name)
          }
        })
      }

      return {
        _id: r._id || `history_${idx}`,
        recipeId: r.recipeId || '',
        recipeName: r.recipeName || '',
        name: r.recipeName || '未知菜品',
        image: r.image || imageMap[r.recipeId] || '',
        experience: r.experience || '',
        cookedAt: new Date(r.cookedAt).getTime(),
        dateStr: `${y}-${m}-${d}`,
        consumedIngredients,
      }
    })

    const hasMore = page * pageSize < total

    return {
      success: true,
      records,
      stats,
      total,
      page,
      pageSize,
      hasMore,
      errMsg: '',
    }

  } catch (err) {
    console.error('❌ 获取做菜历史失败:', err)
    return { success: false, errMsg: err.message || '服务器内部错误' }
  }
}
