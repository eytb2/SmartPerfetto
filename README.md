# SmartPerfetto - AI驱动的Perfetto分析平台

SmartPerfetto 是一个基于 AI 技术的 Perfetto 性能分析平台，帮助 Android 开发者更轻松地分析和优化应用性能。

## 功能特性

### 🔮 AI SQL 生成器
- 用自然语言描述查询需求，AI 自动生成 Perfetto SQL 查询语句
- 支持复杂的关联查询和分析
- 提供详细的查询解释和使用说明

### 📊 Trace 智能分析
- 上传 Perfetto trace 文件进行智能分析
- AI 对话式分析，快速定位性能问题
- 自动生成优化建议和 SQL 查询

### ⚙️ 配置指南
- 详细的 Perfetto Config 配置说明
- 常用场景的配置模板
- 最佳实践和优化建议

### 📚 文章聚合
- 收集最新的 Perfetto 和 Android 性能优化文章
- 技术分享和案例分析
- 定期更新的知识库

## 技术栈

### 前端
- React 18 + TypeScript
- Vite
- Tailwind CSS
- React Router
- React Query

### 后端
- Node.js + Express
- TypeScript
- AI Service: OpenAI / Claude
- Multer (文件上传)

## 快速开始

### 环境要求
- Node.js >= 20.19.0 (前端需要)
- Node.js >= 18.0.0 (后端)
- npm 或 yarn

### 安装依赖

```bash
# 安装根目录依赖
npm install

# 安装前端依赖
cd frontend
npm install

# 安装后端依赖
cd ../backend
npm install
```

### 配置环境变量

在后端目录创建 `.env` 文件：

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# AI Service Configuration
AI_SERVICE=openai  # 或 claude

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4

# Claude Configuration
ANTHROPIC_API_KEY=your_claude_api_key_here
CLAUDE_MODEL=claude-3-5-sonnet-20241022

# File Upload
MAX_FILE_SIZE=2147483648  # 2GB
UPLOAD_DIR=./uploads

# CORS
FRONTEND_URL=http://localhost:5173
```

### 启动开发服务器

```bash
# 启动后端服务
cd backend
npm run dev

# 启动前端服务
cd ../frontend
npm run dev
```

或者使用根目录的并发脚本：

```bash
npm run dev
```

访问 http://localhost:5173 查看应用

## API 文档

### SQL 生成

**POST** `/api/sql/generate`

请求体：
```json
{
  "query": "查找所有耗时超过 100ms 的 slice",
  "context": "分析主线程性能"
}
```

### Trace 上传

**POST** `/api/trace/upload`

Content-Type: `multipart/form-data`

Body: 文件字段名 `file`

### Trace 分析

**POST** `/api/trace/analyze`

请求体：
```json
{
  "fileId": "uploaded-file-id",
  "query": "找出所有的卡顿点",
  "analysisType": "performance"
}
```

## 盈利模式

### 订阅制
- **免费版**: 基础 SQL 生成，每月 5 次 trace 分析
- **专业版**: ¥99/月，无限 SQL 生成，高级分析功能
- **企业版**: ¥499/月，团队协作，API 访问，定制功能

### API 服务
- 按次计费：¥0.1/次 SQL 生成
- 批量包：1000 次 ¥80

### 增值服务
- 性能优化咨询
- 定制化解决方案
- 培训服务

## 部署

### 使用 Docker Compose（推荐）

1. **克隆项目**
```bash
git clone https://github.com/yourusername/smart-perfetto.git
cd smart-perfetto
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，填入你的配置
```

3. **启动服务**
```bash
# 开发环境
docker-compose up -d

# 生产环境
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 使用部署脚本

我们提供了自动化部署脚本：

```bash
# 部署到测试环境
./scripts/deploy.sh staging

# 部署到生产环境
./scripts/deploy.sh production

# 回滚生产环境
./scripts/deploy.sh production rollback

# 清理 Docker 资源
./scripts/deploy.sh staging cleanup
```

### 环境变量说明

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | 是（使用 OpenAI 时） |
| `ANTHROPIC_API_KEY` | Claude API 密钥 | 是（使用 Claude 时） |
| `JWT_SECRET` | JWT 签名密钥 | 是 |
| `STRIPE_SECRET_KEY` | Stripe 私钥 | 是（订阅功能） |
| `DATABASE_URL` | PostgreSQL 数据库 URL | 是（生产环境） |
| `REDIS_URL` | Redis 连接 URL | 是（生产环境） |

### 服务器要求

**最低配置**：
- CPU: 2 核
- 内存: 4GB
- 存储: 20GB SSD
- 系统: Ubuntu 20.04+ / CentOS 8+

**推荐配置**：
- CPU: 4 核
- 内存: 8GB
- 存储: 50GB SSD
- 系统: Ubuntu 22.04 LTS

### SSL 证书配置

1. 使用 Let's Encrypt（推荐）：
```bash
sudo apt install certbot
sudo certbot certonly --nginx -d yourdomain.com
```

2. 将证书复制到项目目录：
```bash
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./ssl/key.pem
```

### 监控和日志

- 应用日志：`docker-compose logs -f`
- Nginx 访问日志：`/var/log/nginx/access.log`
- Nginx 错误日志：`/var/log/nginx/error.log`

### 备份

自动备份脚本已包含在部署中：
- 数据库备份：`./backups/db-backup-*.sql`
- 文件备份：`./backups/uploads-backup-*.tar.gz`

手动备份数据库：
```bash
docker-compose exec postgres pg_dump -U postgres smartperfetto > backup.sql
```

## 贡献指南

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 联系方式

- 项目地址: https://github.com/yourusername/smart-perfetto
- 邮箱: contact@smartperfetto.com