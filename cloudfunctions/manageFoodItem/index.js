const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 管理食材 — 支持跨共享组成员操作
 * action: 'getDetail' | 'consume' | 'update' | 'delete'
 *
 * consume: 扣减食材库存，数量归零时自动标记为已消耗
 *   event.amount: 要扣减的数量（可选，不传则直接标记消耗）
 *
 * update: 更新食材信息
 *   event.updates: 要更新的字段对象 { name, brand, category, location, quantity, unit, productionDate, expiryDate, shelfLifeDays, note }
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

      case 'update': {
        const { updates } = event

        if (!updates || typeof updates !== 'object') {
          return { success: false, errMsg: '缺少更新数据' }
        }

        // 过滤掉不允许更新的字段
        const allowedFields = [
          'name', 'brand', 'category', 'location',
          'quantity', 'unit', 'productionDate',
          'expiryDate', 'shelfLifeDays', 'note'
        ]

        // 构建安全的更新数据
        const updateData = { updatedAt: new Date() }

        for (const field of allowedFields) {
          if (updates.hasOwnProperty(field)) {
            updateData[field] = updates[field]
          }
        }

        // === 自动计算保质期状态 ===
        // 当生产日期或保质期发生变化时，重新计算状态
        const needRecalcStatus = updates.hasOwnProperty('productionDate') || 
                                updates.hasOwnProperty('expiryDate') || 
                                updates.hasOwnProperty('shelfLifeDays')
        
        let oldStatus = item.status || 'fresh'
        let newStatus = oldStatus
        
        if (needRecalcStatus) {
          // 获取最新的过期日期
          let finalExpiryDate = null
          
          // 优先使用 updates 中的 expiryDate
          if (updates.hasOwnProperty('expiryDate')) {
            finalExpiryDate = updates.expiryDate
          } 
          // 如果有 productionDate 和 shelfLifeDays，重新计算 expiryDate
          else if (updates.hasOwnProperty('productionDate') || updates.hasOwnProperty('shelfLifeDays')) {
            const prodDate = updates.productionDate || item.productionDate
            const shelfLife = updates.shelfLifeDays || item.shelfLifeDays
            if (prodDate && shelfLife) {
              const expiry = new Date(prodDate)
              expiry.setDate(expiry.getDate() + shelfLife)
              finalExpiryDate = expiry.toISOString().slice(0, 10)
              // 同时更新 expiryDate 到数据库
              updateData.expiryDate = finalExpiryDate
            }
          }
          // 否则使用原数据的 expiryDate
          else {
            finalExpiryDate = item.expiryDate
          }
          
          if (finalExpiryDate) {
            // 计算新的保质期状态
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const expiry = new Date(finalExpiryDate)
            expiry.setHours(0, 0, 0, 0)
            const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
            
            if (diffDays < 0) {
              newStatus = 'expired'
            } else if (diffDays <= 3) {
              newStatus = 'expiring'
            } else {
              newStatus = 'fresh'
            }
            
            // 只有当原状态不是 'consumed' 时才更新状态
            // （已消耗的食材保持 consumed 状态）
            if (oldStatus !== 'consumed') {
              updateData.status = newStatus
            } else {
              newStatus = oldStatus // 保持原状态
            }
          }
        }

        await db.collection('fridge_items').doc(itemId).update({ data: updateData })
        console.log(`✅ [manageFoodItem] 更新成功: ${itemId}, status: ${oldStatus} → ${newStatus}`)
        
        // 返回状态变更信息给前端
        const statusChanged = oldStatus !== newStatus
        return { 
          success: true, 
          message: '更新成功', 
          errMsg: '',
          statusChanged,
          oldStatus,
          newStatus
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
