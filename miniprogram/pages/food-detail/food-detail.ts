// pages/food-detail/food-detail.ts
import {
  CATEGORY_INFO,
  LOCATION_LABELS,
  EXPIRY_STATUS,
  STATUS_LABELS,
} from '../../utils/constants'
import { getExpiryStatus, getExpiryText, daysBetween } from '../../utils/date'

/**
 * 演示数据映射表（与 fridge.ts / index.ts 的 _getDemoItems 保持一致）
 * 用于在数据库无数据时，详情页能正确展示假数据
 */
const DEMO_ITEMS_MAP: Record<string, any> = (() => {
  const today = new Date()
  const fmt = (d: number) => {
    const t = new Date(today); t.setDate(t.getDate() + d)
    return t.toISOString().slice(0, 10)
  }
  return {
    'demo_001': { _id: 'demo_001', name: '西红柿', brand: '', category: 'vegetable', categoryColor: '#51CF66', quantity: 4, unit: '个', location: 'fridge', expiryDate: fmt(3), productionDate: fmt(-5), shelfLifeDays: 7 },
    'demo_002': { _id: 'demo_002', name: '鸡蛋', brand: '德青源', category: 'other', categoryColor: '#B197FC', quantity: 8, unit: '个', location: 'fridge', expiryDate: fmt(14), productionDate: fmt(-7), shelfLifeDays: 21 },
    'demo_003': { _id: 'demo_003', name: '五花肉', brand: '金龙鱼', category: 'meat', categoryColor: '#FF6B6B', quantity: 500, unit: 'g', location: 'freeze', expiryDate: fmt(30), productionDate: fmt(-10), shelfLifeDays: 90 },
    'demo_004': { _id: 'demo_004', name: '纯牛奶', brand: '蒙牛', category: 'dairy', categoryColor: '#74C0FC', quantity: 2, unit: '盒', location: 'fridge', expiryDate: fmt(5), productionDate: fmt(-12), shelfLifeDays: 21 },
    'demo_005': { _id: 'demo_005', name: '西兰花', brand: '', category: 'vegetable', categoryColor: '#51CF66', quantity: 2, unit: '颗', location: 'fridge', expiryDate: fmt(1), productionDate: fmt(-3), shelfLifeDays: 5 },
    'demo_006': { _id: 'demo_006', name: '苹果', brand: '', category: 'fruit', categoryColor: '#FF922B', quantity: 6, unit: '个', location: 'fridge', expiryDate: fmt(10), productionDate: fmt(-7), shelfLifeDays: 21 },
    'demo_007': { _id: 'demo_007', name: '鸡中翅', brand: '圣农', category: 'meat', categoryColor: '#FF6B6B', quantity: 12, unit: '只', location: 'freeze', expiryDate: fmt(45), productionDate: fmt(-15), shelfLifeDays: 180 },
    'demo_008': { _id: 'demo_008', name: '酸奶', brand: '简爱', category: 'dairy', categoryColor: '#74C0FC', quantity: 4, unit: '杯', location: 'fridge', expiryDate: fmt(-1), productionDate: fmt(-22), shelfLifeDays: 21 },
    'demo_009': { _id: 'demo_009', name: '大葱', brand: '', category: 'vegetable', categoryColor: '#51CF66', quantity: 3, unit: '根', location: 'fridge', expiryDate: fmt(0), productionDate: fmt(-7), shelfLifeDays: 7 },
    'demo_010': { _id: 'demo_010', name: '酱油', brand: '海天', category: 'condiment', categoryColor: '#FFE066', quantity: 1, unit: '瓶', location: 'door', expiryDate: fmt(365), productionDate: fmt(-100), shelfLifeDays: 730 },
    'demo_011': { _id: 'demo_011', name: '胡萝卜', brand: '', category: 'vegetable', categoryColor: '#51CF66', quantity: 3, unit: '根', location: 'fridge', expiryDate: fmt(7), productionDate: fmt(-5), shelfLifeDays: 14 },
    'demo_012': { _id: 'demo_012', name: '可乐', brand: '可口可乐', category: 'beverage', categoryColor: '#E599F7', quantity: 1, unit: '瓶', location: 'fridge', expiryDate: fmt(180), productionDate: fmt(-60), shelfLifeDays: 365 },
  }
})()

/**
 * AI 处理建议生成器
 * 根据食材类别、过期状态和过期天数给出智能处理建议
 */
function generateAIAdvice(item: any, level: string, daysRemaining: number): string {
  const name = item.name || '食材'
  const cat = item.category
  // 已过期的绝对天数（正数）
  const overdueDays = daysRemaining < 0 ? -daysRemaining : 0

  if (level === 'expired') {
    // 过期处理建议
    switch (cat) {
      case 'dairy':
        if (overdueDays <= 3)
          return `${name}过期${overdueDays}天，若无异味和胀包，密封冷藏仍可用于烘焙或制作${name}蛋糕，不建议直接饮用。`
        return `${name}已过期${overdueDays}天，乳制品变质风险较高，建议直接丢弃，切勿食用。`
      case 'vegetable':
        if (overdueDays <= 2)
          return `${name}轻微枯萎但未腐烂，可切掉变软部分后高温快炒食用。如已发黏或长斑则需丢弃。`
        return `${name}已明显变质迹象，为避免食物中毒风险，请立即丢弃。`
      case 'fruit':
        if (overdueDays <= 3 && name.includes('苹果'))
          return `${name}虽过期但质地可能变软，可削去软烂部分做成苹果派或果酱，不建议生吃。`
        return `${name}已过期${overdueDays}天，水果易滋生霉菌，建议丢弃避免肠胃不适。`
      case 'meat':
        return `${name}已过期${overdueDays}天！肉类过期风险极高，即使冷冻也可能变质，强烈建议丢弃。`
      case 'beverage':
        return `${name}过期${overdueDays}天，碳酸饮料通常在保质期外仍可安全饮用（口感可能下降），自行判断后决定。`
      default:
        return `${name}已过期${overdueDays}天。一般食品超过保质期建议谨慎对待，如有异常气味或外观变化请勿食用。`
    }
  } else if (level === 'expiring') {
    // 临期提醒建议
    switch (cat) {
      case 'vegetable':
      case 'fruit':
        return `${name}即将到期，建议优先安排近期食用，或清洗处理后冷冻保存延长保鲜时间。`
      case 'dairy':
        return `${name}临近保质期，可考虑制作甜点（如布丁、蛋糕）加速消耗，开封后尽快用完。`
      case 'meat':
        return `${name}即将临期，建议尽快烹饪或分装密封冷冻保存，可大幅延长保存期限。`
      default:
        return `${name}还剩几天保质期，记得在最近几天内安排食用哦～`
    }
  }
  // 新鲜状态
  return `${name}状态新鲜，正常冷藏/冷冻保存即可。距离过期还有一段时间，不用太担心。`
}

Page({
  data: {
    _id: '',
    name: '',
    brand: '',
    category: '',
    categoryLabel: '',
    categoryIcon: '',
    categoryColor: '',
    quantity: 1,
    unit: '个',
    location: '',
    locationLabel: '',
    locationIcon: '',
    barcode: '',
    productionDate: '',
    expiryDate: '',
    shelfLifeDays: 0,
    note: '',
    status: '',

    // 派生数据 - 状态
    statusClass: '',
    statusIcon: '',
    statusText: '',
    expiryLevel: '',
    expiryDisplayText: '',
    daysRemaining: 0,
    expiryProgress: 0,

    // 新增 - 今天标记
    showTodayMarker: false,
    todayMarkerTop: 24,

    // 新增 - AI 处理建议
    aiAdvice: '',

    // 新增 - 调整库存弹窗
    showStockModal: false,
    adjustMode: 'quick', // 'quick' 或 'precise'
    deltaValue: 0,
    directValue: '',
    previewQuantity: -1,
    stepSize: 1,
  },

  onLoad(options) {
    if (options?.id) {
      this.setData({ _id: options.id })
      this._loadDetail()
    }
  },

  /** 页面重新显示时刷新数据（编辑后返回时确保数据最新） */
  onShow() {
    // 跳过首次 onShow（因为 onLoad 已经加载过数据）
    if (this.data._initialLoadDone && this.data._id) {
      this._loadDetail()
    }
    this.data._initialLoadDone = true
  },

  async _loadDetail() {
    wx.showLoading({ title: '加载中...' })
    
    try {
      // 如果是演示数据（demo_ 开头），直接从本地映射表取数据
      if (this.data._id.startsWith('demo_')) {
        const demoItem = DEMO_ITEMS_MAP[this.data._id]
        if (demoItem) {
          this._renderItem(demoItem)
          return
        }
        // 映射表里也找不到，走数据库查询兜底
      }

      const res = await wx.cloud.callFunction({
        name: 'manageFoodItem',
        data: { action: 'getDetail', itemId: this.data._id }
      })
      const result = res.result as { success: boolean; data?: any; errMsg: string }
      
      if (!result.success || !result.data) {
        wx.showToast({ title: result.errMsg || '食材不存在', icon: 'none' })
        return
      }

      this._renderItem(result.data as any)
    } catch (e) {
      console.error('加载详情失败:', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  /**
   * 渲染食材详情到页面（统一渲染逻辑，支持数据库数据和演示数据）
   */
  _renderItem(item: any) {
    const catInfo = CATEGORY_INFO[item.category] || CATEGORY_INFO.other || {}
    
    // 计算保质期相关数据
    const level = item.expiryDate ? getExpiryStatus(item.expiryDate) : 'fresh'
    const status = item.status || level
    const days = item.expiryDate ? daysBetween(item.expiryDate) : 999
    
    // 计算进度条百分比（已消耗的时间占比）
    let progress = 0
    if (item.productionDate && item.shelfLifeDays > 0) {
      progress = Math.min(100, Math.round(
        (daysBetween(new Date(), new Date(item.productionDate)) / item.shelfLifeDays) * 100
      ))
    } else if (item.productionDate && item.expiryDate) {
      const total = daysBetween(new Date(item.expiryDate), new Date(item.productionDate))
      const elapsed = daysBetween(new Date(), new Date(item.productionDate))
      if (total > 0) progress = Math.min(100, Math.round((elapsed / total) * 100))
    }

    // 计算今天标记位置（今天是否在生产日期和过期日期之间）
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const prodDate = item.productionDate ? new Date(item.productionDate) : null
    const expDate = item.expiryDate ? new Date(item.expiryDate) : null

    let showTodayMarker = false
    let todayMarkerTop = 24 // 默认位置
    if (prodDate && expDate) {
      prodDate.setHours(0, 0, 0, 0)
      expDate.setHours(0, 0, 0, 0)
      if (today >= prodDate && today <= expDate) {
        showTodayMarker = true
        // 计算今天在线段上的相对位置（0~48rpx 范围内）
        const totalMs = expDate.getTime() - prodDate.getTime()
        const elapsedMs = today.getTime() - prodDate.getTime()
        const ratio = totalMs > 0 ? elapsedMs / totalMs : 0
        todayMarkerTop = Math.max(4, Math.min(44, Math.round(ratio * 40) + 4))
      }
    }

    // 生成 AI 处理建议
    const aiAdvice = generateAIAdvice(item, level, days)

    this.setData({
      ...item,
      categoryLabel: catInfo.label || '其他',
      categoryIcon: catInfo.icon || '📦',
      categoryColor: item.categoryColor || catInfo.color || '#B197FC',
      locationLabel: LOCATION_LABELS[item.location] || '',
      locationIcon: { fridge: '🧊', freeze: '❄️', door: '🚪' }[item.location] || '📍',
      
      // 状态显示
      statusClass: level,
      statusIcon: { fresh: '✅', expiring: '⚠️', expired: '❌', consumed: '✓' }[status] || '✅',
      statusText: STATUS_LABELS[status] || '新鲜',
      expiryDisplayText: item.expiryDate ? getExpiryText(item.expiryDate) : '',
      
      // 倒计时与进度
      expiryLevel: level,
      daysRemaining: days >= 0 ? days : -days,
      expiryProgress: progress,

      // 今天标记
      showTodayMarker,
      todayMarkerTop,

      // AI 建议
      aiAdvice,
    })
  },

  /** 查看可用菜谱（跳转推荐页） */
  goRecipes() {
    // 带上当前食材名作为搜索关键词，方便筛选相关菜谱
    const keyword = encodeURIComponent(this.data.name || '')
    // ★ 关键：tabBar 页面即便 onLoad 不再触发，参数仍可由 onShow 读取
    // 这里同时写入全局缓存，供菜谱页 onShow 兜底读取
    const app = getApp<any>()
    app._pendingIngredient = decodeURIComponent(keyword)

    // 注意：菜谱页是 tabBar 页面，必须使用 switchTab 才能跳转
    wx.switchTab({
      url: `/pages/recipes/recipes?ingredient=${keyword}`,
      fail: (err) => {
        // 兜底：若页面配置发生变化不再属于 tabBar，尝试普通跳转
        console.warn('switchTab 失败，回退到 navigateTo:', err)
        wx.navigateTo({ url: `/pages/recipes/recipes?ingredient=${keyword}` })
      },
    })
  },

  /** 显示调整库存弹窗 */
  showAdjustStock() {
    if (this.data._id.startsWith('demo_')) {
      wx.showToast({ title: '演示数据无法操作', icon: 'none' })
      return
    }
    this.setData({
      showStockModal: true,
      adjustMode: 'quick',
      deltaValue: 0,
      directValue: '',
      previewQuantity: this.data.quantity,
      stepSize: 1,
    })
  },

  /** 隐藏调整库存弹窗 */
  hideAdjustStock() {
    this.setData({ showStockModal: false })
  },

  /** 阻止事件冒泡 */
  preventBubble() {
    // 阻止点击弹窗内容时关闭弹窗
  },

  /** 切换调整模式 */
  switchAdjustMode(e: any) {
    const mode = e.currentTarget.dataset.mode
    this.setData({
      adjustMode: mode,
      previewQuantity: this.data.quantity,
    })
  },

  /** 设置步长 */
  setStepSize(e: any) {
    const step = parseInt(e.currentTarget.dataset.step) || 1
    this.setData({ stepSize: step })
  },

  /** 快速调整：加减按钮 */
  adjustDelta(e: any) {
    const value = parseInt(e.currentTarget.dataset.value) || 0
    const newQty = Math.max(0, this.data.previewQuantity + value)
    this.setData({ previewQuantity: newQty })
  },

  /** 精确输入 */
  onDirectInput(e: any) {
    const value = e.detail.value
    const qty = parseFloat(value) || 0
    this.setData({
      directValue: value,
      previewQuantity: qty,
    })
  },

  /** 数字键盘输入 */
  padInput(e: any) {
    const num = e.currentTarget.dataset.num
    const current = this.data.directValue || ''
    const newVal = current + num
    const qty = parseFloat(newVal) || 0
    this.setData({
      directValue: newVal,
      previewQuantity: qty,
    })
  },

  /** 数字键盘删除 */
  padDelete() {
    const current = this.data.directValue || ''
    const newVal = current.slice(0, -1)
    const qty = parseFloat(newVal) || 0
    this.setData({
      directValue: newVal,
      previewQuantity: newVal ? qty : this.data.quantity,
    })
  },

  /** 确认调整库存 */
  async confirmAdjustStock() {
    const { previewQuantity, quantity, _id } = this.data

    if (previewQuantity < 0) {
      wx.showToast({ title: '库存不能为负数', icon: 'none' })
      return
    }

    if (previewQuantity === quantity) {
      wx.showToast({ title: '库存未变更', icon: 'none' })
      return
    }

    wx.showLoading({ title: '更新中...' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'manageFoodItem',
        data: {
          action: 'update',
          itemId: _id,
          updates: { quantity: previewQuantity }
        }
      })
      const result = res.result as { success: boolean; errMsg: string }
      
      if (!result.success) {
        throw new Error(result.errMsg)
      }

      // 更新页面数据
      const updatedData = { ...this.data, quantity: previewQuantity, _id }
      this._renderItem(updatedData)
      
      this.setData({
        showStockModal: false,
      })

      wx.showToast({ title: '库存已更新', icon: 'success' })
    } catch (e: any) {
      console.error('调整库存失败:', e)
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  /** 编辑 */
  editItem() {
    // 演示数据不支持编辑
    if (this.data._id.startsWith('demo_')) {
      wx.showToast({ title: '演示数据无法编辑', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/add-food/add-food?id=${this.data._id}&mode=edit` })
  },

  /** 删除确认 */
  confirmDelete() {
    // 演示数据不支持删除
    if (this.data._id.startsWith('demo_')) {
      wx.showToast({ title: '演示数据无法删除', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认删除',
      content: `确定要删除「${this.data.name}」吗？此操作不可恢复。`,
      confirmColor: '#FF6B6B',
      success: (res) => {
        if (res.confirm) {
          this._deleteItem()
        }
      },
    })
  },

  async _deleteItem() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageFoodItem',
        data: { action: 'delete', itemId: this.data._id }
      })
      const result = res.result as { success: boolean; errMsg: string }
      if (!result.success) {
        throw new Error(result.errMsg)
      }
      wx.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1200)
    } catch (e: any) {
      console.error('删除失败:', e)
      wx.showToast({ title: e.message || '删除失败', icon: 'none' })
    }
  },
})
