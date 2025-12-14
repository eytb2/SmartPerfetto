# SmartPerfetto 部署指南

本文档详细说明了如何部署 SmartPerfetto，包括 Perfetto UI 的集成。

## 部署架构

```
┌─────────────────┐    ┌─────────────────┐
│   前端 (React)   │    │   Perfetto UI   │
│   - AI SQL生成   │◄──►│   - 查询编辑器   │
│   - Trace分析    │    │   - 时间线视图   │
│   - 用户认证     │    │   - 数据可视化   │
└─────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────┐
│       API网关 (Nginx)              │
│   - HTTPS 终结                    │
│   - 静态文件服务                    │
│   - API 路由转发                    │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│     后端服务 (Node.js)              │
│   - JWT 认证                       │
│   - AI 服务集成                     │
│   - 文件上传处理                    │
│   - Stripe 支付                     │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  数据存储与处理                      │
│   - PostgreSQL (用户数据)           │
│   - Redis (缓存)                     │
│   - 文件存储 (Trace 文件)           │
│   - Perfetto Trace Processor        │
└─────────────────────────────────────┘
```

## 部署方案

### 方案一：使用官方 Perfetto UI（推荐）

这种方式最简单，直接使用官方 CDN 加载 Perfetto UI，无需构建。

#### 优点
- 自动更新到最新版本
- 无需维护 UI 代码
- 部署简单快速

#### 步骤

1. **克隆项目**
```bash
git clone https://github.com/yourusername/smart-perfetto.git
cd smart-perfetto
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件
```

3. **使用 Docker Compose 部署**
```bash
# 生产环境
docker-compose up -d

# 查看日志
docker-compose logs -f
```

### 方案二：自建 Perfetto UI

完全控制 UI 版本，可以进行深度定制。

#### 先决条件
- Python 3.8+
- Node.js 18+
- 至少 8GB 内存
- 50GB 可用磁盘空间

#### 构建步骤

1. **克隆 Perfetto 仓库**
```bash
# 在 SmartPerfetto 目录同级
git clone https://github.com/google/perfetto.git
```

2. **运行构建脚本**
```bash
cd smart-perfetto
./scripts/build-perfetto.sh
```

3. **配置自定义 URL**
在 `.env` 中设置：
```env
PERFETTO_UI_URL=/perfetto-ui/perfetto.js
```

4. **部署**
```bash
docker-compose up -d
```

## 环境配置

### 必需的环境变量

```bash
# 服务器配置
PORT=3001
NODE_ENV=production

# AI 服务
AI_SERVICE=openai  # 或 claude
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_claude_api_key

# JWT 认证
JWT_SECRET=your-super-secret-jwt-key

# Stripe 支付
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRO_PRICE_ID=price_xxx
STRIPE_ENTERPRISE_PRICE_ID=price_xxx

# 数据库
POSTGRES_DB=smartperfetto
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
DATABASE_URL=postgresql://postgres:your_password@postgres:5432/smartperfetto

# Redis
REDIS_URL=redis://redis:6379

# 文件上传
MAX_FILE_SIZE=2147483648  # 2GB
UPLOAD_DIR=./uploads

# CORS
FRONTEND_URL=https://yourdomain.com
```

### 前端环境变量

```bash
# Vite 环境变量
VITE_API_URL=https://api.yourdomain.com
VITE_STRIPE_PUBLIC_KEY=pk_test_xxx
```

## Docker 配置

### 生产环境 Docker Compose

```yaml
version: '3.8'

services:
  # Nginx 反向代理
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
      - ./frontend/dist:/usr/share/nginx/html
    depends_on:
      - api
    networks:
      - smart-perfetto

  # 后端 API
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./uploads:/app/uploads
    networks:
      - smart-perfetto

  # PostgreSQL 数据库
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - smart-perfetto

  # Redis 缓存
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    networks:
      - smart-perfetto

volumes:
  postgres-data:
  redis-data:

networks:
  smart-perfetto:
    driver: bridge
```

### 开发环境配置

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      - VITE_API_URL=http://localhost:3001/api

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.dev
    ports:
      - "3001:3001"
    volumes:
      - ./backend:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
    env_file:
      - .env
```

## Nginx 配置

### 生产环境配置

```nginx
# nginx.conf
events {
    worker_connections 1024;
}

http {
    # HTTPS 重定向
    server {
        listen 80;
        server_name smartperfetto.com;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS 服务器
    server {
        listen 443 ssl http2;
        server_name smartperfetto.com;

        # SSL 配置
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;

        # 前端静态文件
        location / {
            root /usr/share/nginx/html;
            index index.html;
            try_files $uri $uri/ /index.html;

            # 缓存配置
            location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
                expires 1y;
                add_header Cache-Control "public, immutable";
            }
        }

        # API 代理
        location /api/ {
            proxy_pass http://api:3001;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # WebSocket 支持
        location /ws {
            proxy_pass http://api:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
        }

        # Stripe webhook
        location /api/auth/webhook {
            proxy_pass http://api:3001;
        }
    }
}
```

## 监控和日志

### 日志配置

1. **应用日志**
```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务
docker-compose logs -f api
```

2. **Nginx 访问日志**
```bash
tail -f /var/log/nginx/access.log
```

3. **错误日志**
```bash
tail -f /var/log/nginx/error.log
```

### 健康检查

```bash
# API 健康检查
curl https://api.smartperfetto.com/health

# 前端健康检查
curl -I https://smartperfetto.com/
```

## SSL 证书配置

### Let's Encrypt (免费)

```bash
# 安装 Certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d smartperfetto.com -d api.smartperfetto.com

# 自动续期
sudo crontab -e
# 添加：0 12 * * * /usr/bin/certbot renew --quiet
```

### 自签名证书（开发用）

```bash
# 生成私钥
openssl genrsa -out private.key 2048

# 生成证书
openssl req -new -x509 -key private.key -out certificate.crt -days 365
```

## 备份策略

### 数据库备份

```bash
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="./backups"

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份数据库
docker-compose exec postgres pg_dump -U postgres smartperfetto > $BACKUP_DIR/db-backup-$DATE.sql

# 备份上传文件
tar -czf $BACKUP_DIR/uploads-backup-$DATE.tar.gz uploads/

# 清理旧备份（保留30天）
find $BACKUP_DIR -name "*.sql" -mtime +30 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
```

### 自动备份设置

```bash
# 添加到 crontab
0 2 * * * /path/to/smart-perfetto/backup.sh
```

## 性能优化

### 数据库优化

1. **PostgreSQL 配置**
```sql
-- 创建索引
CREATE INDEX idx_slice_ts ON slice(ts);
CREATE INDEX idx_thread_utid ON thread(utid);
CREATE INDEX idx_process_upid ON process(upid);
```

2. **查询优化**
- 使用 LIMIT 限制结果集
- 避免全表扫描
- 合理使用 JOIN

### 缓存策略

1. **Redis 缓存**
- API 响应缓存（5分钟）
- 查询结果缓存（10分钟）
- 会话缓存（24小时）

2. **Nginx 缓存**
- 静态资源长期缓存
- API 响应短期缓存

## 安全配置

### 防火墙规则

```bash
# UFW 配置
sudo ufw enable
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw deny 5432/tcp   # 数据库（仅内部访问）
```

### 安全头配置

```nginx
add_header X-Frame-Options DENY;
add_header X-Content-Type-Options nosniff;
add_header X-XSS-Protection "1; mode=block";
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
```

## 扩展部署

### Kubernetes 部署

1. **创建命名空间**
```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: smart-perfetto
```

2. **部署配置**
```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: smart-perfetto-api
  namespace: smart-perfetto
spec:
  replicas: 3
  selector:
    matchLabels:
      app: smart-perfetto-api
  template:
    metadata:
      labels:
        app: smart-perfetto-api
    spec:
      containers:
      - name: api
        image: your-registry/smart-perfetto-api:latest
        ports:
        - containerPort: 3001
        env:
        - name: NODE_ENV
          value: "production"
```

### 微服务架构

1. **API 网关** - Kong/Traefik
2. **服务发现** - Consul/Etcd
3. **消息队列** - RabbitMQ/Kafka
4. **负载均衡** - HAProxy/Nginx Plus

## 故障排除

### 常见问题

1. **Perfetto UI 加载失败**
   - 检查网络连接
   - 确认 CDN 路径正确
   - 查看浏览器控制台错误

2. **AI 服务无响应**
   - 检查 API Key 配置
   - 查看后端日志
   - 验证 OpenAI/Anthropic 配额

3. **文件上传失败**
   - 检查文件大小限制
   - 确认存储空间充足
   - 查看上传目录权限

4. **数据库连接错误**
   - 检查数据库状态
   - 验证连接字符串
   - 查看网络配置

### 调试命令

```bash
# 进入容器调试
docker-compose exec api sh

# 查看进程状态
docker-compose ps

# 重启服务
docker-compose restart api

# 查看资源使用
docker stats
```

## 监控指标

### 关键指标

1. **系统指标**
   - CPU 使用率 < 80%
   - 内存使用率 < 85%
   - 磁盘使用率 < 90%
   - 网络延迟 < 100ms

2. **应用指标**
   - API 响应时间 < 500ms
   - 错误率 < 1%
   - 并发用户数
   - 活跃会话数

3. **业务指标**
   - 日活跃用户
   - SQL 生成次数
   - Trace 分析次数
   - 付费转化率

### 监控工具

1. **Prometheus + Grafana**
   - 指标收集
   - 可视化仪表板
   - 告警配置

2. **ELK Stack**
   - 日志收集
   - 日志分析
   - 错误追踪

3. **APM 工具**
   - New Relic
   - DataDog
   - Sentry

## 总结

SmartPerfetto 的部署需要考虑：

1. **高可用性** - 多实例部署，负载均衡
2. **可扩展性** - 微服务架构，自动伸缩
3. **安全性** - HTTPS，认证，授权
4. **性能** - 缓存，优化，监控
5. **备份** - 定期备份，灾难恢复

选择适合您需求的部署方案，并根据实际情况调整配置。