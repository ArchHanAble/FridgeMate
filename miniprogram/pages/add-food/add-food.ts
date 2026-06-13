// pages/add-food/add-food.ts
import {
  CATEGORIES,
  CATEGORY_INFO,
  CATEGORY_ORDER,
  LOCATIONS,
  LOCATION_LABELS,
  EXPIRY_STATUS,
} from '../../utils/constants'
import { calcExpiryDate, formatDate, getExpiryStatus, getExpiryText, daysBetween } from '../../utils/date'

/** 单次识别结果（支持多来源追加） */
interface SourceResult {
  id: string              // 唯一标识：'scan_xxx' | 'photo_xxx'
  type: 'scan' | 'photo'  // 来源类型
  label: string            // 显示标签：'扫码结果' | '拍照OCR'
  icon: string             // 📷 / 🔍
  status: 'loading' | 'success' | 'error'
  name: string             // 商品名
  brand?: string           // 品牌
  shelfLifeDays?: number   // 保质期天数
  category?: string        // 分类
  barcode?: string         // 条码（仅扫码）
  imageUrl?: string        // 预览图（仅拍照）
  message?: string         // 补充说明 / 错误信息
  rawText?: string         // OCR原始文字（拍照时保留）
  filledFields: string[]   // 已填充到表单的字段列表
  // === 派生字段：WXML 直接读取的布尔值（避免复杂表达式解析问题）===
  _showBrand: boolean      // 是否显示品牌行
  _showShelfLife: boolean  // 是否显示保质期行
  _showBarcode: boolean    // 是否显示条码行
}

Page({
  data: {
    // 当前选中的模式（仅高亮用）
    currentMode: 'manual',

    // 编辑模式
    isEditMode: false,
    editItemId: '',

    /** 多来源结果列表（追加模式） */
    results: [] as SourceResult[],

    // 表单数据
    formData: {
      name: '',
      brand: '',
      category: 'vegetable',
      location: 'fridge',
      quantity: 1,
      unit: '个',
      productionDate: '',
      shelfLifeDays: '',
      expiryDate: '',
      note: '',
    },

    // 分类选项（用于picker）
    categories: [] as any[],
    locations: [] as any[],

    // 保质期输入方式：days | date
    shelfMode: 'days',
    presetShelfLives: [
      { label: '7天', days: 7 },
      { label: '15天', days: 15 },
      { label: '30天', days: 30 },
      { label: '90天', days: 90 },
      { label: '180天', days: 180 },
      { label: '365天', days: 365 },
    ],

    calculatedExpiryDate: '',
    today: formatDate(new Date()),
    maxProdDate: formatDate(new Date()),
    submitting: false,
    
    // 保质期状态预览
    expiryStatus: '',
    expiryStatusText: '',
    expiryStatusClass: '',
    daysRemaining: 0,
  },

  onLoad(options) {
    this._buildCategories()
    this._buildLocations()

    // 检测是否为编辑模式
    if (options?.mode === 'edit' && options?.id) {
      this.setData({
        isEditMode: true,
        editItemId: options.id,
      })
      wx.setNavigationBarTitle({ title: '编辑食材' })
      this._loadItemForEdit(options.id)
      return
    }

    if (options?.mode && ['scan', 'photo'].includes(options.mode)) {
      if (options.mode === 'scan') this.startScan()
      else this.takePhoto()
    }
  },

  /**
   * 加载现有食材数据用于编辑
   */
  async _loadItemForEdit(itemId: string) {
    wx.showLoading({ title: '加载中...' })
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageFoodItem',
        data: { action: 'getDetail', itemId }
      })
      const result = res.result as { success: boolean; data?: any; errMsg: string }
      
      if (!result.success || !result.data) {
        wx.showToast({ title: result.errMsg || '食材不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
        return
      }

      const item = result.data
      
      // 确定保质期输入模式
      let shelfMode = 'days'
      if (item.expiryDate && !item.shelfLifeDays) {
        shelfMode = 'date'
      } else if (item.expiryDate && item.shelfLifeDays) {
        shelfMode = 'days'
      }

      // 填充表单数据
      this.setData({
        formData: {
          name: item.name || '',
          brand: item.brand || '',
          category: item.category || 'vegetable',
          location: item.location || 'fridge',
          quantity: item.quantity || 1,
          unit: item.unit || '个',
          productionDate: item.productionDate || '',
          shelfLifeDays: item.shelfLifeDays ? String(item.shelfLifeDays) : '',
          expiryDate: item.expiryDate || '',
          note: item.note || '',
        },
        shelfMode,
      }, () => this._calcExpiry())
      
      // 隐藏顶部的添加方式选择（编辑模式下不需要）
    } catch (e) {
      console.error('加载食材数据失败:', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    } finally {
      wx.hideLoading()
    }
  },

  /* ==================== 初始化 ==================== */

  _buildCategories() {
    const categories = []
    for (const cat of CATEGORY_ORDER) {
      const info = CATEGORY_INFO[cat]
      if (info) categories.push({ value: cat, label: info.label, icon: info.icon })
    }
    this.setData({ categories })
  },

  _buildLocations() {
    const locations = []
    for (const [key, label] of Object.entries(LOCATION_LABELS)) {
      const icons: Record<string, string> = { fridge: '🧊', freeze: '❄️', door: '🚪' }
      locations.push({ value: key, label, icon: icons[key] || '📍' })
    }
    this.setData({ locations })
  },

  /* ==================== 模式切换（不覆盖任何数据）==================== */

  switchMode(e: WechatMiniprogram.TouchEvent) {
    this.setData({ currentMode: e.currentTarget.dataset.mode })
  },

  /** 生成唯一结果ID */
  _newId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  },

  /** 为结果对象计算派生布尔字段（避免 WXML 复杂表达式解析问题） */
  _deriveBooleans(result: SourceResult): SourceResult {
    const isLoading = result.status === 'loading'
    const notLoading = !isLoading
    return {
      ...result,
      _isLoading: isLoading,
      _showBrand: !!(result.brand && notLoading),
      _showShelfLife: !!(result.shelfLifeDays && notLoading),
      _showBarcode: !!(result.barcode && notLoading),
    }
  },

  /** 追加一条结果到列表 */
  _addResult(result: SourceResult) {
    const results = [...this.data.results, this._deriveBooleans(result)]
    this.setData({ results })
  },

  /** 更新某条结果的状态 */
  _updateResult(id: string, patch: Partial<SourceResult>) {
    const results = this.data.results.map(r => {
      if (r.id === id) {
        const merged = { ...r, ...patch }
        return this._deriveBooleans(merged)
      }
      return r
    })
    this.setData({ results })
  },

  /* ==================== 扫码识别 ==================== */

  startScan() {
    this.setData({ currentMode: 'scan' })

    // 先插入一个 loading 状态的结果卡片
    const loadingId = this._newId('scan')
    this._addResult({
      id: loadingId,
      type: 'scan',
      label: '📷 扫码结果',
      icon: '📷',
      status: 'loading',
      name: '正在查询...',
      filledFields: [],
    })

    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['barCode'],
      success: async (res) => {
        console.log('扫码条码:', res.result)

        try {
          const cloudRes = await wx.cloud.callFunction({
            name: 'scanBarcode',
            data: { barcode: res.result },
          })

          if (cloudRes?.result?.product) {
            const p = cloudRes.result.product
            const filled = this._mergeIntoForm(p, 'scan')
            this._updateResult(loadingId, {
              status: 'success',
              name: p.name || p.fullName || '未知商品',
              brand: p.brand,
              shelfLifeDays: p.shelfLifeDays,
              barcode: res.result,
              message: filled.length > 0 ? `已自动填入 ${filled.join('、')}` : '',
              filledFields: filled,
            })
          } else {
            this._updateResult(loadingId, {
              status: 'error',
              name: '未识别的商品',
              barcode: res.result,
              message: '请手动填写信息',
            })
          }
        } catch (e) {
          console.error('扫码失败:', e)
          this._updateResult(loadingId, {
            status: 'error',
            name: '网络异常',
            barcode: String(res.result),
            message: '请手动填写信息',
          })
        }
      },
      fail: () => {
        // 用户取消 → 移除 loading 卡片
        this.setData({
          results: this.data.results.filter(r => r.id !== loadingId),
          currentMode: 'manual',
        })
      },
    })
  },

  /* ==================== 拍照OCR识别（识别包装上的文字信息）==================== */

  takePhoto() {
    this.setData({ currentMode: 'photo' })

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (chooseRes) => {
        const tempPath = chooseRes.tempFiles[0].tempFilePath
        const photoId = this._newId('photo')

        this._addResult({
          id: photoId,
          type: 'photo',
          label: '🔍 拍照OCR',
          icon: '🔍',
          status: 'loading',
          name: '正在识别文字...',
          imageUrl: tempPath,
          filledFields: [],
        })

        try {
          // Step 1: 上传图片到云存储
          const cloudPath = `food-ocr/${Date.now()}_${Math.random().toString(36).slice(2,8)}.jpg`
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath, filePath: tempPath,
          })
          if (!uploadRes.fileID) throw new Error('图片上传失败')
          console.log('📸 图片已上传:', uploadRes.fileID)

          // Step 2: 调用云函数进行 OCR 文字识别
          const ocrRes = await wx.cloud.callFunction({
            name: 'recognizeFood',
            data: { imagePath: uploadRes.fileID, mode: 'ocr_only' },
          })

          const rawText = ocrRes.result?.rawText || ocrRes.result?.text || ''
          console.log('🔍 OCR原始文字:', rawText.substring(0, 200))

          // Step 3: 从OCR文字中解析结构化字段
          const parsed = this._parseOCRText(rawText)

          // Step 4: 合并到表单（只填充空字段）
          const filled = this._mergeIntoForm(parsed, 'ocr')

          this._updateResult(photoId, {
            status: 'success',
            name: parsed.name || '识别完成',
            brand: parsed.brand || undefined,
            shelfLifeDays: parsed.shelfLifeDays,
            imageUrl: tempPath,
            message: filled.length > 0
              ? `已提取 ${filled.join('、')}${parsed.rawName ? `\n识别文字：「${parsed.rawName}」` : ''}`
              : '未能自动提取有效信息，可参考下方识别文字手动填写',
            rawText: rawText,
            filledFields: filled,
          })
        } catch (e: any) {
          console.error('❌ OCR识别失败:', e)
          this._updateResult(photoId, {
            status: 'error',
            name: '识别遇到问题',
            imageUrl: tempPath,
            message: '可以手动输入或重拍一张更清晰的照片',
          })
        }
      },
      fail: () => {
        this.setData({ currentMode: 'manual' })
      },
    })
  },

  /**
   * 从 OCR 原始文字中智能解析出结构化字段
   * 匹配规则：
   *   - 商品名称：通常是最长的一行非日期非规格文字，或在"品名"/"产品名称"/"食品名称"后面
   *   - 品牌："品牌"、"商标"、知名品牌关键词
   *   - 生产日期："生产日期"、"生产日期(年/月/日)"、"制造日期"等 + 日期格式
   *   - 保质期："保质期"、"保质期至"、"保质期(月/日/年)" + 数字 + 天/月/年
   */
  _parseOCRText(rawText: string): {
    name?: string; brand?: string; shelfLifeDays?: number;
    productionDate?: string; rawName?: string;
  } {
    if (!rawText.trim()) return {}

    const lines = rawText.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return {}

    const result: any = {}
    let rawName = ''

    // ====== 1. 提取生产日期 ======
    const prodDatePatterns = [
      /(?:生产日期|生产|制造日期|生产日期\(.*?\)|产\s*期)[\s:：]*(\d{4}[-./年]\d{1,2}[-./月]\d{1,2}[日]?)/,
      /(\d{4})[年./](\d{1,2})[月./](\d{1,2})[日]?\s*(?=\s|$|\n)/,
      /生产日期[\s:：]*([^\n]{4,20}?)(?=\n|$)/,
    ]
    for (const pat of prodDatePatterns) {
      const m = rawText.match(pat)
      if (m) {
        // 标准化为 YYYY-MM-DD
        let dStr = m[1] || (m[1] + '-' + m[2] + '-' + m[3])
        dStr = dStr.replace(/[年.]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, '')
        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dStr)) {
          result.productionDate = dStr
          break
        }
      }
    }

    // ====== 2. 提取保质期 ======
    const shelfPatterns = [
      /保质期[\s:：至到]*[（(]?\s*(\d+)\s*[天日月年]\s*[)）]?/,
      /保质期\s*[:：]?\s*([^\n]{2,30}?)(?=\n|$)/,
      /(\d+)\s*(?:个月|月)/,
      /(\d+)\s*天/,
    ]
    for (const pat of shelfPatterns) {
      const m = rawText.match(pat)
      if (m) {
        const num = Number(m[1])
        if (num > 0 && num < 10000) {
          const unitMatch = m[0].match(/[天日月年]/)
          const unit = unitMatch ? unitMatch[0] : '天'
          let days = num
          if (unit === '月') days = num * 30
          else if (unit === '年') days = num * 365
          result.shelfLifeDays = Math.min(days, 3650) // 上限约10年
          break
        }
      }
    }

    // ====== 3. 提取品牌 ======
    const brandPatterns = [
      /(?:品牌|商标|厂名|制造商)[\s:：]*([^\n,，;；]{2,15}?)(?=\n|$|[;；,，])/,
      /^(.{2,10})(?:有限公司|集团|股份公司|食品有限公司|乳业|酒业|饮料)/m,
    ]
    for (const pat of brandPatterns) {
      const m = rawText.match(pat)
      if (m && m[1]) {
        const b = m[1].trim()
        if (b.length >= 2 && b.length <= 15 && !/^\d+$/.test(b)) {
          result.brand = b.replace(/^[品牌商标:：\s]+/, '').trim()
          break
        }
      }
    }

    // ====== 4. 提取商品名称（优先级最高）=====
    const namePatterns = [
      /(?:产品名称|食品名称|品名|物品名称|商品名|配料)[\s:：]*([^\n,，;；]{2,40}?)(?=\n|$|[;；,，]|规格)/,
      /^(.+)$/m,  // 兜底取第一行有意义的长文本
    ]

    // 筛选有意义的行（排除纯数字、过短的行、日期行等）
    const meaningfulLines = lines.filter(line => {
      const t = line.trim()
      if (t.length < 2) return false
      if (/^\d+$/.test(t)) return false
      if (/^\d{4}[-./]/.test(t)) return false  // 日期行
      if (/^(营养成分|配料表|储存条件|食用方法|产地|地址|电话|网址|批号)/.test(t)) return false
      return true
    })

    for (const pat of namePatterns) {
      const m = rawText.match(pat)
      if (m && m[1]) {
        const n = m[1].trim()
        // 过滤掉明显不是名字的
        if (n.length >= 2 && n.length <= 50 && !/^\d/.test(n)) {
          result.name = n
          rawName = n
          break
        }
      }
    }

    // 兜底：如果上面没找到名字，用最长的有意义的行
    if (!result.name && meaningfulLines.length > 0) {
      const longest = meaningfulLines.reduce((a, b) => a.length >= b.length ? a : b, '')
      if (longest.length >= 2 && longest.length <= 50) {
        result.name = longest
        rawName = longest
      }
    }

    result.rawName = rawName
    return result
  },

  /**
   * 将识别结果合并到表单（追加模式：只填充空字段，不覆盖已有内容）
   * @returns 已成功填充的字段名数组
   */
  _mergeIntoForm(data: any, source: string): string[] {
    const updates: Record<string, any> = {}
    const filled: string[] = []

    // 名称：空才填
    if (data.name && !this.data.formData.name) {
      updates['formData.name'] = typeof data.name === 'string' ? data.name : (data.name || '')
      filled.push('名称')
    }
    // 品牌：空才填
    if ((data.brand || data.brandName) && !this.data.formData.brand) {
      updates['formData.brand'] = data.brand || data.brandName || ''
      filled.push('品牌')
    }
    // 分类：默认值不算已填
    if (data.category && this.data.formData.category === 'vegetable' && !this.data.formData.name) {
      updates['formData.category'] = data.category
      filled.push('分类')
    }
    // 保质期：空才填
    if (data.shelfLifeDays && !this.data.formData.shelfLifeDays) {
      updates['formData.shelfLifeDays'] = String(data.shelfLifeDays)
      updates.shelfMode = 'days'
      filled.push('保质期')
    }
    // 生产日期：空才填
    if (data.productionDate && !this.data.formData.productionDate) {
      updates['formData.productionDate'] = data.productionDate
      filled.push('生产日期')
    }

    if (Object.keys(updates).length > 0) {
      this.setData(updates as any, () => this._calcExpiry())
    }

    return filled
  },

  /* ==================== 结果操作 ==================== */

  /** 移除某条结果 */
  removeResult(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    this.setData({
      results: this.data.results.filter(r => r.id !== id),
    })
  },

  /** 重新执行某来源的操作 */
  reDo(e: WechatMiniprogram.TouchEvent) {
    const item = this.data.results.find((r: any) => r.id === e.currentTarget.dataset.id)
    if (!item) return
    // 先移除旧结果，再重新触发
    this.removeResult(e)
    if (item.type === 'scan') this.startScan()
    else if (item.type === 'photo') this.takePhoto()
  },

  /* ==================== 表单事件处理 ==================== */

  onInput(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field as string
    const value = e.detail.value
    this.setData({ [`formData.${field}`]: value } as any)

    if (field === 'productionDate' || field === 'shelfLifeDays') {
      this._calcExpiry()
    }
  },

  selectCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'formData.category': e.currentTarget.dataset.value })
  },

  selectLocation(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'formData.location': e.currentTarget.dataset.value })
  },

  changeQty(e: WechatMiniprogram.TouchEvent) {
    const delta = Number(e.currentTarget.dataset.delta)
    let newQty = this.data.formData.quantity + delta
    newQty = Math.max(1, Math.min(99, newQty))
    this.setData({ 'formData.quantity': newQty })
  },

  onDateChange(e: WechatMiniprogram.PickerChange) {
    const field = e.currentTarget.dataset.field as string
    this.setData({ [`formData.${field}`]: e.detail.value } as any)
    if (field === 'productionDate' || field === 'expiryDate') this._calcExpiry()
  },

  switchShelfMode(e: WechatMiniprogram.TouchEvent) {
    this.setData({ shelfMode: e.currentTarget.dataset.val }, () => this._calcExpiry())
  },

  setPresetShelf(e: WechatMiniprogram.TouchEvent) {
    const days = e.currentTarget.dataset.days
    this.setData({ 'formData.shelfLifeDays': String(days) }, () => this._calcExpiry())
  },

  /** 计算过期日期和保质期状态（预览用） */
  _calcExpiry() {
    const { productionDate, shelfLifeDays, expiryDate } = this.data.formData
    let calculatedExpiryDate = ''
    
    // 计算过期日期
    if (productionDate && shelfLifeDays && !isNaN(Number(shelfLifeDays))) {
      calculatedExpiryDate = calcExpiryDate(productionDate, Number(shelfLifeDays))
      this.setData({ calculatedExpiryDate })
    } else {
      this.setData({ calculatedExpiryDate: '' })
    }
    
    // 计算保质期状态预览
    const finalExpiryDate = expiryDate || calculatedExpiryDate
    if (finalExpiryDate) {
      const status = getExpiryStatus(finalExpiryDate)
      const statusText = getExpiryText(finalExpiryDate)
      const days = daysBetween(finalExpiryDate)
      
      this.setData({
        expiryStatus: status,
        expiryStatusText: statusText,
        expiryStatusClass: status,
        daysRemaining: days >= 0 ? days : -days,
      })
    } else {
      this.setData({
        expiryStatus: '',
        expiryStatusText: '',
        expiryStatusClass: '',
        daysRemaining: 0,
      })
    }
  },

  /* ==================== 表单验证与提交 ==================== */

  _validate(): boolean {
    const { name, category, quantity } = this.data.formData

    if (!name.trim()) {
      wx.showToast({ title: '请填写食材名称', icon: 'none' }); return false
    }
    if (!category) {
      wx.showToast({ title: '请选择分类', icon: 'none' }); return false
    }
    if (!quantity || quantity < 1) {
      wx.showToast({ title: '数量至少为1', icon: 'none' }); return false
    }
    if (this.data.shelfMode === 'days') {
      if (!this.data.formData.shelfLifeDays || isNaN(Number(this.data.formData.shelfLifeDays))) {
        wx.showToast({ title: '请填写保质期天数', icon: 'none' }); return false
      }
    } else {
      if (!this.data.formData.expiryDate) {
        wx.showToast({ title: '请选择过期日期', icon: 'none' }); return false
      }
    }
    return true
  },

  async submitForm() {
    if (this.data.submitting) return
    if (!this._validate()) return

    this.setData({ submitting: true })

    try {
      const { formData, shelfMode, results, isEditMode, editItemId } = this.data

      const dataToSave: Record<string, any> = {
        name: formData.name.trim(),
        brand: formData.brand?.trim(),
        category: formData.category,
        location: formData.location,
        quantity: Number(formData.quantity),
        unit: formData.unit || '个',
        productionDate: formData.productionDate,
        note: formData.note?.trim(),
        updatedAt: new Date(),
      }

      // 处理保质期
      if (shelfMode === 'days') {
        dataToSave.shelfLifeDays = Number(formData.shelfLifeDays)
        if (formData.productionDate) {
          dataToSave.expiryDate = calcExpiryDate(formData.productionDate, Number(formData.shelfLifeDays))
        }
      } else {
        dataToSave.expiryDate = formData.expiryDate
        if (formData.productionDate && formData.expiryDate) {
          const prod = new Date(formData.productionDate)
          const expiry = new Date(formData.expiryDate)
          dataToSave.shelfLifeDays = Math.ceil((expiry.getTime() - prod.getTime()) / (1000 * 60 * 60 * 24))
        }
      }

      let res: any

      if (isEditMode) {
        // 编辑模式：调用更新接口
        dataToSave._id = editItemId
        res = await wx.cloud.callFunction({
          name: 'manageFoodItem',
          data: { action: 'update', itemId: editItemId, updates: dataToSave },
        })

        if (res.result?.success) {
          // 检查状态是否变更，给出相应提示
          const { statusChanged, oldStatus, newStatus } = res.result
          const statusLabels = { fresh: '新鲜', expiring: '临期', expired: '已过期', consumed: '已用完' }
          
          if (statusChanged) {
            const oldLabel = statusLabels[oldStatus] || oldStatus
            const newLabel = statusLabels[newStatus] || newStatus
            wx.showModal({
              title: '更新成功',
              content: `食材「${dataToSave.name}」已更新。\n状态变更：${oldLabel} → ${newLabel}`,
              showCancel: false,
              confirmText: '知道了',
              confirmColor: '#FF6A88'
            })
          } else {
            wx.showToast({ title: '✨ 更新成功！', icon: 'success', duration: 1500 })
          }
          setTimeout(() => wx.navigateBack(), statusChanged ? 3000 : 1200)
        } else {
          throw new Error(res.result?.errMsg || '更新失败')
        }
      } else {
        // 新增模式：原有逻辑
        dataToSave.status = 'fresh'
        // 来源记录（可能多个）
        dataToSave.sources = results.map((r: SourceResult) => r.type)
        dataToSave.createdAt = new Date()

        // 收集条码（从所有扫码结果中取第一个有效的）
        for (const r of results) {
          if (r.barcode) { dataToSave.barcode = r.barcode; break }
        }

        res = await wx.cloud.callFunction({
          name: 'addFoodItem',
          data: dataToSave,
        })

        if (res.result?.success || res.result?._id || res.result?.id) {
          wx.showToast({ title: '✨ 已加入冰箱！', icon: 'success', duration: 1500 })
          setTimeout(() => wx.navigateBack(), 1200)
        } else {
          throw new Error(res.result?.errMsg || '保存失败')
        }
      }
    } catch (e: any) {
      console.error('提交失败:', e)
      wx.showToast({ 
        title: e.message || (this.data.isEditMode ? '更新失败' : '添加失败') + '，请重试', 
        icon: 'none' 
      })
    } finally {
      this.setData({ submitting: false })
    }
  },

  dataToSaveForDirectSave(): any { return {} },
})
