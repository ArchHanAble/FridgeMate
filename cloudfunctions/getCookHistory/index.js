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

    // === 1. 获取所有做菜记录（按时间倒序，最近50条）===
    const res = await db.collection('cooking_history')
      .where({ _openid: _.in(queryOpenids) })
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
      if (count > maxFreq) {
        maxFreq = count
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

      // 处理 consumedIngredients 字段，兼容旧数据格式（string[]）和新数据格式（{name, amount}[]）
      let consumedIngredients = []
      
      // 1. 先处理 consumedIngredients（已消耗的食材）
      if (Array.isArray(r.consumedIngredients)) {
        consumedIngredients = r.consumedIngredients.map(item => {
          // 旧格式：item 是 string (食材名称)
          if (typeof item === 'string') {
            return { name: item, amount: 0, unit: '' }
          }
          // 新格式：item 是 object {name, amount, unit}
          return {
            name: item.name || '',
            amount: item.amount || 0,
            unit: item.unit || ''
          }
        }).filter(item => item.name) // 过滤掉名称为空的项
      }
      
      // 2. 合并 missingInFridge（冰箱中没有的食材）
      if (Array.isArray(r.missingInFridge)) {
        const existingNames = new Set(consumedIngredients.map(item => item.name))
        
        r.missingInFridge.forEach(item => {
          let name = ''
          let amount = 0
          let unit = ''
          
          // 兼容不同的数据格式
          if (typeof item === 'string') {
            name = item
          } else if (item && typeof item === 'object') {
            name = item.name || ''
            amount = item.amount || 0
            unit = item.unit || ''
          }
          
          if (!name) return // 跳过名称为空的项
          
          // 检查是否已存在同名的食材
          if (existingNames.has(name)) {
            // 已存在，跳过（保留原有数据）
            console.log(`⚠️ 食材 "${name}" 已存在于 consumedIngredients 中，跳过 missingInFridge 中的重复项`)
          } else {
            // 不存在，添加进去
            consumedIngredients.push({
              name: name,
              amount: amount,
              unit: unit
            })
            existingNames.add(name) // 更新集合，避免后续重复
          }
        })
      }

      return {
        _id: r._id || `history_${idx}`,
        recipeId: r.recipeId || '',
        recipeName: r.recipeName || '',  // 菜谱名称（用于搜索）
        name: r.recipeName || '未知菜品',  // 菜名（用于显示）
        // 优先使用记录中保存的自定义图片（用户上传的图片），如果没有才使用菜谱图片
        image: r.image || imageMap[r.recipeId] || '',
        experience: r.experience || '',  // 做菜心得分享
        cookedAt: new Date(r.cookedAt).getTime(),
        dateStr: `${y}-${m}-${d}`,
        consumedIngredients: consumedIngredients, // 消耗的食材列表（含名称和数量）
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
