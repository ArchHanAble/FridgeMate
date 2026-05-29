# 🧊 FridgeMate 冰箱智能管家

> 帮你管理冰箱食材 · 追踪保质期 · 智能推荐菜谱  
> 让每一份食材都不被浪费 ❤️

## 📱 项目简介

一款温馨可爱的微信小程序，解决独居/情侣/家庭用户的日常痛点：

- **冰箱里有什么？** 一目了然的食材清单，分类展示
- **什么时候过期？** 自动追踪保质期，临期/过期提醒
- **今晚吃什么？** 根据现有食材智能匹配菜谱
- **一个人怎么吃？** 支持一人食、两人食、家庭三种场景

## ✨ 核心功能

### 🧊 我的冰箱
- 手动添加 / 条码扫描 / 拍照识别（三种方式录入）
- 7大分类：蔬菜、水果、肉类、乳制品、饮料、调料、其他
- 3个存储位置追踪：冷藏室、冷冻室、门架
- 搜索 + 分类筛选 + 多维度排序

### ⏰ 保质期管理
- 生产日期 → 自动计算过期时间
- 扫码自动匹配品牌保质期（蒙牛、伊利、海天等50+品牌）
- 全网搜索保质期信息
- 临期（3天内）+ 已过期醒目标识
- 微信订阅消息推送提醒（每日9点定时检查）

### 🍳 菜谱推荐引擎
- 内置 **10+ 道经典家常菜谱**（西红柿炒鸡蛋、红烧肉、可乐鸡翅...）
- 支持**对接TheMealDB API**获取全球300+道海外菜谱（免费，无需申请密钥）
- 智能匹配算法：同义词映射（"番茄=西红柿"、"土鸡蛋=鸡蛋"）
- 三种场景模式：
  - 🍱 **一人食** — 快手小份菜优先
  - 💕 **两人食** — 有仪式感的双人餐
  - 👨‍👩‍👧‍👦 **家庭餐** — 营养均衡的大份量
- 匹配度百分比 + 缺料提示 + 一键加入购物清单
- 菜谱详情：步骤指引 + 食材清单 + 营养信息 + 一键清耗

### 🛒 购物清单
- 菜谱缺料一键加入
- 手动添加购物项
- 勾选完成 + 清除已完成

### 👨‍👩‍👧‍👦 冰箱共享
- 邀请家人/室友共享同一冰箱数据
- 邀请码机制（安全便捷）

## 🎨 设计风格

**温馨可爱 (Warm & Cute)**
- 主色调：暖橙粉渐变 `#FF9A8B → #FF6A88`
- 大圆角卡片 + 柔和阴影
- 可爱图标 + 微动效（弹性缩放、呼吸灯）
- 渐变色进度条 + 状态动画

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | 微信小程序 (WXML/WXSS/TypeScript) | 原生开发 |
| **状态管理** | App.globalData + wx.storage | 轻量方案 |
| **UI组件** | 自研组件库 | food-card / recipe-card / scene-switcher 等 |
| **后端** | 微信云开发 | 云函数 + 云数据库 |
| **数据库** | 文档型数据库 (类MongoDB) | 5个核心集合 |
| **定时任务** | 云函数定时触发器 | 每日9:00检查保质期 |
| **消息推送** | 微信订阅消息 | 临期/过期提醒 |

## 📁 项目结构

```
fridge-mate/
├── miniprogram/                    # 小程序前端
│   ├── pages/
│   │   ├── index/                  # 首页（总览+推荐）
│   │   ├── fridge/                 # 冰箱页面（分类列表）
│   │   ├── food-detail/            # 食材详情
│   │   ├── add-food/               # 添加食材（手动/扫码/拍照）
│   │   ├── recipes/                # 菜谱发现
│   │   ├── recipe-detail/          # 菜谱详情+烹饪
│   │   ├── shopping-list/          # 购物清单
│   │   └── profile/                # 个人中心（设置/共享）
│   ├── components/                 # 公共组件
│   │   ├── food-card/              # 食材卡片
│   │   ├── recipe-card/            # 菜谱卡片
│   │   ├── scene-switcher/         # 场景切换器
│   │   └── empty-state/            # 空状态占位
│   ├── utils/                      # 工具函数
│   │   ├── constants.ts            # 常量定义
│   │   ├── date.ts                 # 日期工具
│   │   ├── api.ts                  # 云函数封装
│   │   └── matcher.ts              # 食材-菜谱匹配算法
│   ├── styles/                     # 样式系统
│   │   ├── variables.wxss          # CSS变量（色彩/圆角/阴影/动画）
│   │   ├── app.wxss               # 全局样式
│   │   └── animations.wxss         # 动画库
│   ├── app.ts                      # 应用入口
│   └── app.json                    # 配置文件
├── cloudfunctions/                 # 云函数后端
│   ├── addFoodItem/                # 添加食材
│   ├── scanBarcode/                # 扫码识别
│   ├── getRecipeRecommendations/   # 菜谱推荐引擎 ⭐核心
│   ├── fetchMealDB/               # TheMealDB 海外菜谱 API 代理 ⭐新增
│   ├── consumeIngredients/         # 一键清耗
│   ├── checkExpiry/                # 定时保质期检查
│   ├── searchBrandProduct/         # 全网搜索品牌保质期
│   ├── inviteShare/                # 邀请共享
│   └── acceptInvite/              # 接受邀请
└── database/                       # 初始数据脚本
    └── init_data.js                # 菜谱+品牌数据
```

## 🗄️ 数据库设计

### 5个核心集合

1. **`fridge_items`** - 食材记录
2. **`recipes`** - 菜谱数据
3. **`brand_shelf_life`** - 品牌保质期库（50+品牌）
4. **`user_settings`** - 用户偏好设置
5. **`shopping_list`** - 购物清单
6. **`shared_fridges`** - 冰箱共享组
7. **`cooking_history`** - 做菜历史

详细字段定义见 [规划文档](brain/fridge-mate-plan.md)

## 🚀 快速开始

### 1. 环境准备
```bash
# 1. 安装微信开发者工具
# https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html

# 2. 注册微信小程序账号
# https://mp.weixin.qq.com

# 3. 开通云开发环境
# 在开发者工具中 → 云开发 → 创建环境
```

### 2. 导入项目
```bash
# 用微信开发者工具打开 fridge-mate 目录
# 修改 project.config.json 中的 appid 为你自己的 appid
# 修改 app.ts 中的 envId 为你的云开发环境ID
```

### 3. 安装依赖并构建
```bash
cd fridge-mate/miniprogram
npm install --production
# 在开发者工具中点击「工具 → 构建npm」
```

### 4. 部署云函数
```bash
# 右键每个云函数目录 → 上传并部署（云端安装依赖）
# 需要部署的云函数：
# - addFoodItem
# - scanBarcode
# - getRecipeRecommendations
# - fetchMealDB
# - consumeIngredients
# - checkExpiry (含定时触发器配置)
# - searchBrandProduct
# - inviteShare
# - acceptInvite
```

### 5. 创建数据库集合
在云开发控制台 → 数据库 中创建以下集合：
- `fridge_items`
- `recipes`
- `brand_shelf_life`
- `user_settings`
- `shopping_list`
- `shared_fridges`
- `cooking_history`
- `notifications`

### 6. 配置权限规则
各集合建议的数据库权限设置：
- 所有集合：仅创建者可读写（`auth.openid === _openid`）

## 📋 开发计划

### Phase 1 ✅ MVP（当前完成）
- [x] 项目初始化 + UI框架搭建
- [x] 温馨可爱风格设计系统
- [x] 食材 CRUD + 分类展示
- [x] 保质期手动设置 + 进度条
- [x] 10道内置菜谱 + 匹配算法
- [x] 三种场景切换
- [x] 购物清单功能
- [x] 个人中心基础设置

### Phase 2 🔧 智能化增强（已完成）
- [x] 对接**TheMealDB API**获取全球海外菜谱
- [x] 拍照AI识别食材（OCR/图像识别）
- [ ] 订阅消息推送（需申请模板ID）
- [ ] 更多品牌保质期数据接入
- [ ] 做菜历史统计

### Phase 3 🎯 体验打磨（规划中）
- [ ] 数据看板（消耗分析/浪费统计）
- [ ] 智能购物建议
- [ ] 菜谱UGC（用户投稿）
- [ ] 营养摄入统计
- [ ] 社交分享功能

## 📝 注意事项

1. **AppID 替换**: 使用前务必替换 `project.config.json` 中的 `appid` 和 `app.ts` 中的 `envId`
2. **云函数部署**: 每个云函数都需要右键单独上传部署
3. **订阅消息**: 需要在小程序管理后台申请模板ID才能使用到期提醒
4. **TheMealDB API**: 免费开放 API（https://www.themealdb.com/api.php），无需申请密钥

## 📄 License

MIT License © 2026 FridgeMate

---

Made with ❤️ for every home cook 🧊
# -


## 🗄️ 数据库设计

> 以下根据当前代码仓库梳理（云开发集合 + 本地 Storage）。  
> 每条云文档均含系统字段：`_id`（string，文档 ID）、`_openid`（string，创建者 openid，权限控制依据）。

### 集合总览

| 集合名 | 存储 | 用途 |
|--------|------|------|
| `users` | 云数据库 | 微信登录用户档案 |
| `fridge_items` | 云数据库 | 冰箱食材 |
| `recipes` | 云数据库 | 自建/缓存菜谱（主流程多用 TheMealDB API） |
| `brand_shelf_life` | 云数据库 | 商品条码与保质期库 |
| `user_settings` | 云数据库（设计）/ 本地 Storage | 用户偏好与通知（云侧多读少写） |
| `shared_fridges` | 云数据库 | 共享冰箱组 |
| `cooking_history` | 云数据库 | 做菜历史 |
| `notifications` | 云数据库 | 站内通知（订阅消息失败降级） |
| `notify_logs` | 云数据库 | 推送日志 |
| `shopping_list` | **仅本地** `wx.setStorageSync` | 购物清单（README 曾列作云集合，代码未接入） |

### 数据关系与完整字段

```mermaid
flowchart TB
  subgraph SYS["系统字段（各云集合文档均可能有）"]
    direction TB
    S1["_id : string — 文档唯一ID（云数据库自动生成）"]
    S2["_openid : string — 记录创建者微信openid（权限「仅创建者可读写」依据）"]
  end

  subgraph users["users — 用户登录档案"]
    direction TB
    U1["nickName : string — 用户昵称，未设置则为空字符串"]
    U2["avatarUrl : string — 头像 URL（云存储 fileID 或网络地址）"]
    U3["scenario : string — 场景模式：single / couple / family"]
    U4["notifyEnabled : boolean — 是否开启到期提醒（新用户默认 false）"]
    U5["notifyDaysBefore : number — 提前几天提醒（新用户默认 3）"]
    U6["loginCount : number — 累计登录次数（老用户每次登录 +1）"]
    U7["lastActiveAt : Date — 最后活跃时间"]
    U8["createdAt : Date — 账号创建时间"]
    U9["updatedAt : Date — 资料最后更新时间（updateProfile 写入）"]
    U10["_init : boolean — 临时标记，仅集合初始化时用，随后删除"]
  end

  subgraph user_settings["user_settings — 用户偏好与通知"]
    direction TB
    US1["openid : string — 备用用户标识（批量推送任务读取）"]
    US2["nickName : string — 显示昵称（邀请/共享时展示）"]
    US3["notifyEnabled : boolean — 是否开启到期提醒"]
    US4["notifyDaysBefore : number — 提前提醒天数"]
    US5["templateId : string — 微信订阅消息模板 ID"]
    US6["notifySubscribed : boolean — 是否已授权订阅（仅本地存储）"]
    US7["notifyBeforeDays : number — 提前天数（本地命名，同 notifyDaysBefore）"]
    US8["scenario : string — 场景模式（仅本地存储）"]
    US9["dietPrefs : object — 饮食偏好（仅本地存储）"]
    US9a["  ├ tastes : string[] — 口味标签多选"]
    US9b["  ├ allergies : string[] — 忌口/过敏原"]
    US9c["  └ dietType : string — 饮食类型，如 normal"]
  end

  subgraph fridge_items["fridge_items — 冰箱食材"]
    direction TB
    F1["name : string — 食材名称（必填）"]
    F2["brand : string — 品牌"]
    F3["category : string — 分类：meat/vegetable/dairy/condiment/beverage/other 等"]
    F4["location : string — 存放位置：fridge / freeze / door"]
    F5["quantity : number — 数量"]
    F6["unit : string — 单位，如 个、g、ml"]
    F7["productionDate : string|null — 生产日期 YYYY-MM-DD"]
    F8["expiryDate : string|null — 过期日期 YYYY-MM-DD"]
    F9["shelfLifeDays : number — 保质期天数"]
    F10["note : string — 备注"]
    F11["barcode : string|null — 商品条码"]
    F12["image : string|null — 图片 fileID 或 URL"]
    F13["source : string — 录入来源，如 manual（云函数写入）"]
    F14["sources : string[] — 多来源标记（小程序直连写入）"]
    F15["isAutoExpiry : boolean — 是否由品牌库自动推算保质期"]
    F16["status : string — fresh/expiring/expired/consumed（代码中还过滤 wasted）"]
    F17["consumed : boolean — 是否已消耗（sendExpiryNotify 查询用，与 status 未统一）"]
    F18["sharedGroupId : string — 共享组ID（注释规划，当前未写入）"]
    F19["createdAt : Date — 创建时间"]
    F20["updatedAt : Date — 更新时间"]
  end

  subgraph brand_shelf_life["brand_shelf_life — 品牌保质期库"]
    direction TB
    B1["barcode : string — 商品条码（查询主键之一）"]
    B2["brandName : string — 品牌名"]
    B3["productName : string — 产品简称"]
    B4["fullName : string — 完整商品名（模糊搜索）"]
    B5["shelfLifeDays : number — 默认保质期天数"]
    B6["storageCondition : string — 储存条件说明"]
    B7["category : string — 商品分类"]
    B8["isVerified : boolean — 是否人工校验"]
    B9["source : string — 数据来源：local/openfoodfacts/builtin"]
    B10["lastUpdated : Date — 缓存更新时间"]
    B11["imageUrl : string|null — 商品图片 URL"]
  end

  subgraph recipes["recipes — 菜谱文档"]
    direction TB
    R1["name : string — 菜名"]
    R2["description : string — 简介"]
    R3["cookTime : number — 烹饪时长（分钟）"]
    R4["difficulty : string — easy / medium / hard"]
    R5["tags : string[] — 标签（菜系、地区等）"]
    R6["servings : object — 各场景份量 {single,couple,family}"]
    R7["likes : number — 点赞/热度"]
    R8["ingredients : array — 食材列表（见下方子结构）"]
    R9["steps : array — 步骤列表（见下方子结构）"]
    R10["image : string — 封面图 URL"]
    R11["strMealThumb : string — MealDB 缩略图字段"]
    R12["source : string — 来源标识，如 mealdb"]
    R13["nutrition : object|null — 营养信息（多为 null）"]
  end

  subgraph cooking_history["cooking_history — 做菜历史"]
    direction TB
    C1["recipeId : string — 关联菜谱 ID（可空）"]
    C2["recipeName : string — 菜名快照"]
    C3["image : string — 菜谱封面（recordCook 写入）"]
    C4["consumedIngredients : array — 已消耗食材（见下方子结构）"]
    C5["missingInFridge : string[] — 冰箱中缺失的食材名"]
    C6["source : string — manual=手动标记；清耗模式可能为空"]
    C7["cookedAt : Date — 做菜时间"]
    C8["createdAt : Date — 记录创建时间"]
  end

  subgraph shared_fridges["shared_fridges — 共享冰箱组"]
    direction TB
    SF1["ownerOpenId : string — 群主 openid"]
    SF2["ownerName : string — 群主显示名"]
    SF3["inviteCode : string — 邀请码，如 FRIDGE-XXXXXX"]
    SF4["members : array — 成员列表（见下方子结构）"]
    SF5["pendingInvites : array — 待处理邀请（创建时 []）"]
    SF6["status : string — 组状态，如 active"]
    SF7["createdAt : Date — 创建时间"]
    SF8["updatedAt : Date — 更新时间"]
  end

  subgraph notifications["notifications — 站内通知"]
    direction TB
    N1["type : string — 通知类型，如 expiry_alert"]
    N2["content : string — 通知正文"]
    N3["read : boolean — 是否已读"]
    N4["createdAt : Date — 创建时间"]
  end

  subgraph notify_logs["notify_logs — 推送日志"]
    direction TB
    NL1["openid : string — 目标用户 openid（注意非 _openid）"]
    NL2["type : string — 日志类型，如 expiry_reminder"]
    NL3["totalCount : number — 本次待推送总数"]
    NL4["successCount : number — 成功条数"]
    NL5["failCount : number — 失败条数"]
    NL6["createdAt : Date — 记录时间"]
  end

  subgraph shopping_local["shopping_list — 购物清单（仅本地）"]
    direction TB
    SL1["存储 : wx.setStorageSync"]
    SL2["结构 : array，项字段无统一云 schema"]
  end

  users -->|"1:N _openid"| fridge_items
  users -->|"1:N _openid"| cooking_history
  users -->|"1:N _openid"| notifications
  users -->|"1:N openid"| notify_logs
  users -->|"1:0..1 ownerOpenId"| shared_fridges
  users -->|"N:M members.openId"| shared_fridges
  users -.->|"设计1:1，实际未打通"| user_settings
  brand_shelf_life -->|"barcode"| fridge_items
  recipes -->|"recipeId"| cooking_history
  recipes -->|"食材名匹配"| fridge_items
  shared_fridges -.->|"规划 sharedGroupId"| fridge_items