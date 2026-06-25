// components/food-card/food-card.ts
import { getExpiryStatus, getExpiryText, daysBetween } from '../../utils/date'
import { LOCATION_LABELS, STATUS_LABELS } from '../../utils/constants'

Component({
  properties: {
    /** 食材名称 */
    name: { type: String, value: '' },
    /** 品牌 */
    brand: { type: String, value: '' },
    /** 分类 */
    category: { type: String, value: 'other' },
    /** 分类颜色 */
    categoryColor: { type: String, value: '#B197FC' },
    /** 数量 */
    quantity: { type: Number, value: 1 },
    /** 单位 */
    unit: { type: String, value: '个' },
    /** 存储位置 */
    location: { type: String, value: '' },
    /** 过期日期 YYYY-MM-DD */
    expiryDate: { type: String, value: '' },
    /** 生产日期 */
    productionDate: { type: String, value: '' },
    /** 保质期总天数（用于计算进度条） */
    shelfLifeDays: { type: Number, value: 0 },
    /** 状态 */
    status: { type: String, value: 'fresh' },
    /** 是否显示箭头 */
    showArrow: { type: Boolean, value: true },
  },

  data: {
    statusText: '',
    statusClass: '',
    expiryLevel: '',
    expiryPercent: 0,
    expiryText: '',
    expiryTextColor: '',
    locationText: '',
    expired: false,
    expiring: false,
    /** 是否显示"已消耗"气泡 */
    showConsumeBubble: false,
  },

  observers: {
    'expiryDate, productionDate, shelfLifeDays, status': function (
      this: WechatMiniprogram.Component.Instance<
        Record<string, any>,
        Record<string, any>,
        { onTap(): void }
      >,
      _expiryDate: string,
      _productionDate: string,
      _shelfLifeDays: number,
      _status: string
    ) {
      this._updateExpiryInfo()
    },
    'location'() {
      this.setData({ locationText: LOCATION_LABELS[this.data.location] || '' })
    },
    'status'() {
      this._updateStatusDisplay()
    },
  },

  lifetimes: {
    attached() {
      this._updateExpiryInfo()
      this._updateStatusDisplay()
      this.setData({ locationText: LOCATION_LABELS[this.properties.location] || '' })
    },
    detached() {
      this._clearBubbleTimer()
    },
  },

  pageLifetimes: {
    hide() {
      this._hideBubble()
    },
  },

  methods: {
    _updateExpiryInfo() {
      const { expiryDate, productionDate, shelfLifeDays } = this.properties

      if (!expiryDate) return

      // 计算状态
      const level = getExpiryStatus(expiryDate)
      this.setData({
        expiryLevel: level,
        expired: level === 'expired',
        expiring: level === 'expiring',
        expiryText: getExpiryText(expiryDate),
        expiryTextColor: `text-${level}`,
      })

      // 计算进度条百分比
      if (productionDate && shelfLifeDays > 0) {
        const elapsed = daysBetween(new Date(), new Date(productionDate))
        const percent = Math.min(100, Math.max(0, Math.round((elapsed / shelfLifeDays) * 100)))
        this.setData({ expiryPercent: percent })
      }
    },

    _updateStatusDisplay() {
      const { status } = this.properties
      if (status && status !== 'fresh') {
        this.setData({
          statusText: STATUS_LABELS[status] || '',
          statusClass: status,
          expired: status === 'expired',
          expiring: status === 'expiring',
        })
      } else {
        this.setData({ statusText: '', statusClass: '' })
      }
    },

    onTap() {
      this.triggerEvent('tap', {
        name: this.properties.name,
        ...this.properties,
      })
    },

    /** 长按食材卡片 — 弹出"已消耗"气泡 */
    onLongPress() {
      // 已消耗的不弹出
      if (this.properties.status === 'consumed') {
        wx.showToast({ title: '该食材已消耗', icon: 'none' })
        return
      }
      // 清除之前的定时器
      this._clearBubbleTimer()
      // 显示气泡
      this.setData({ showConsumeBubble: true })
      // 3秒后自动隐藏
      this._bubbleTimer = setTimeout(() => {
        this._hideBubble()
      }, 3000)
    },

    /** 点击气泡中的"已消耗" — 触发 consumetap 事件给父页面 */
    onConsumeTap() {
      this._hideBubble()
      this.triggerEvent('consumetap', {
        name: this.properties.name,
        quantity: this.properties.quantity,
        unit: this.properties.unit,
        status: this.properties.status,
      })
    },

    /** 隐藏气泡 */
    _hideBubble() {
      this._clearBubbleTimer()
      if (this.data.showConsumeBubble) {
        this.setData({ showConsumeBubble: false })
      }
    },

    /** 清除定时器 */
    _clearBubbleTimer() {
      if (this._bubbleTimer) {
        clearTimeout(this._bubbleTimer)
        this._bubbleTimer = null
      }
    },
  },
})
