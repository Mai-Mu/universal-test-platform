# Ubuntu + Docker Nginx 部署教程

本文用于把通用测试用例管理平台部署到 Ubuntu 云服务器，并接入已经通过 Docker 运行的普通 Nginx。

目标结构：

```text
公网 80/443
    ↓
现有 Nginx 容器
    ↓ 共享 Docker 网络
test-platform:3000
    ↓
宿主机 ./data/testcases.db
```

平台镜像由 GitHub Actions 自动构建并发布到：

```text
ghcr.io/mai-mu/universal-test-platform:latest
```

服务器只拉取成品镜像，不再构建 Node.js 应用。平台的 3000 端口不会发布到宿主机或公网。

如果服务器无法访问 GitHub 或 GHCR，不要在服务器反复重试构建或拉取，改用 [离线部署说明](offline-deployment.md)。

## 一、安全组和防火墙

云服务器只需要对外开放：

| 端口 | 用途 |
| ---: | --- |
| 22 | SSH，推荐仅允许自己的公网 IP |
| 80 | HTTP 和证书验证 |
| 443 | HTTPS |

不要开放 3000 端口。

如果使用 UFW：

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

启用 UFW 前必须先允许 OpenSSH。

## 二、确认现有 Nginx 容器

查看容器：

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

查看 Nginx 当前加入的 Docker 网络，将 `NGINX_CONTAINER` 替换成真实容器名：

```bash
docker inspect NGINX_CONTAINER --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}'
```

可以直接复用其中一个用户自定义 bridge 网络。不要使用 Docker 内置的 `bridge` 网络，因为该网络不提供这里需要的容器名解析。

如果还没有适合共享的网络，创建一个：

```bash
docker network create web
```

然后在 Nginx 自己的 Compose 文件中加入：

```yaml
services:
  nginx:
    networks:
      - web

networks:
  web:
    external: true
```

执行 Nginx 项目的 `docker compose up -d` 让配置持久生效。临时执行 `docker network connect web NGINX_CONTAINER` 虽然也能连接，但 Nginx 容器重建后可能丢失，不建议作为长期配置。

## 三、拉取项目部署配置

```bash
mkdir -p /data
cd /data
git clone https://github.com/Mai-Mu/universal-test-platform.git
cd /data/universal-test-platform
git status
git log -1 --oneline
```

如果目录已经存在：

```bash
cd /data/universal-test-platform
git status
git pull --ff-only origin main
```

## 四、配置平台

```bash
cd /data/universal-test-platform
cp .env.example .env
nano .env
```

示例：

```dotenv
APP_IMAGE=ghcr.io/mai-mu/universal-test-platform:latest
PROXY_NETWORK=web
TZ=Asia/Shanghai
```

`PROXY_NETWORK` 必须等于 Nginx 容器实际使用的共享网络名。保存后：

```bash
chmod 600 .env
docker compose config --services
docker compose config --images
```

预期只有一个 `app` 服务，不包含 Caddy 或另一个 Nginx。

## 五、准备 SQLite 数据

创建数据和备份目录：

```bash
mkdir -p /data/universal-test-platform/data/backups
```

如果要迁移现有数据库，把经过一致性检查的 SQLite 快照上传到：

```text
/data/universal-test-platform/data/testcases.db
```

然后设置目录权限。应用镜像内使用 UID/GID 1000：

```bash
cd /data/universal-test-platform
chown -R 1000:1000 data
chmod 750 data data/backups
chmod 640 data/testcases.db
```

如果不迁移旧库，平台首次启动时会创建新数据库，但仍应保证 `data/` 可由 UID 1000 写入。

## 六、拉取并启动平台

```bash
cd /data/universal-test-platform
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 app
```

预期 `app` 最终为 `healthy`。

确认平台和 Nginx 在同一网络中：

```bash
docker network inspect web
```

如果实际网络名不是 `web`，替换为 `.env` 中的 `PROXY_NETWORK`。

## 七、配置普通 Nginx 容器

仓库提供示例：

```text
deploy/nginx-test-platform.conf.example
```

复制到 Nginx 挂载的配置目录，并按实际情况修改：

- `server_name` 改为真实域名；
- 保持上游地址为 `test-platform:3000`；
- 保留 `resolver 127.0.0.11`，使平台容器重建并更换内部 IP 后 Nginx 能重新解析；
- 如果已有 HTTPS `server` 块，把 `location /` 和上游配置合并进去；
- 证书继续使用你现有的签发和续期方式。

平台没有内置登录。公网使用时必须保留 Nginx Basic Auth，或者先实现平台账号鉴权。

交互式生成密码文件。密码通过标准输入交给 `htpasswd`，不会出现在命令历史或容器环境变量中：

```bash
mkdir -p /你的-nginx-配置目录/auth
read -rsp '请输入平台访问密码: ' TEST_PLATFORM_PASSWORD; echo
read -rsp '请再次输入平台访问密码: ' TEST_PLATFORM_PASSWORD_CONFIRM; echo
[ "$TEST_PLATFORM_PASSWORD" = "$TEST_PLATFORM_PASSWORD_CONFIRM" ] || { unset TEST_PLATFORM_PASSWORD TEST_PLATFORM_PASSWORD_CONFIRM; echo '两次密码不一致'; exit 1; }
printf '%s\n' "$TEST_PLATFORM_PASSWORD" | docker run --rm -i public.ecr.aws/docker/library/httpd:2.4-alpine htpasswd -niB qzz > /你的-nginx-配置目录/auth/test-platform.htpasswd
unset TEST_PLATFORM_PASSWORD TEST_PLATFORM_PASSWORD_CONFIRM
chmod 640 /你的-nginx-配置目录/auth/test-platform.htpasswd
```

将密码文件只读挂载到 Nginx：

```yaml
services:
  nginx:
    volumes:
      - /你的-nginx-配置目录/auth/test-platform.htpasswd:/etc/nginx/auth/test-platform.htpasswd:ro
```

先检查配置，再平滑加载：

```bash
docker exec NGINX_CONTAINER nginx -t
docker exec NGINX_CONTAINER nginx -s reload
```

## 八、部署后验证

在 Nginx 容器内验证 Docker 网络和应用：

```bash
docker exec NGINX_CONTAINER getent hosts test-platform
docker exec NGINX_CONTAINER wget -qO- http://test-platform:3000/api/projects
```

验证公网未认证请求：

```bash
curl -I https://你的域名
```

启用 Basic Auth 后预期返回 `401`。再交互式输入密码：

```bash
curl -I -u qzz https://你的域名
```

最后在浏览器检查：

1. HTTPS 证书有效；
2. 未输入密码不能进入平台；
3. 项目数和用例数与迁移前记录一致；
4. 修改一条测试备注，刷新后仍然存在；
5. 能创建并下载数据库备份。

## 九、日常更新

GitHub 的 `main` 分支更新后会自动构建镜像。等待 Actions 成功，再在服务器执行：

```bash
cd /data/universal-test-platform
git pull --ff-only origin main
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 app
```

数据库保存在宿主机 `data/`，更新镜像不会删除数据库。

## 十、回滚

每次构建同时发布完整提交哈希标签。在 `.env` 中指定旧版本：

```dotenv
APP_IMAGE=ghcr.io/mai-mu/universal-test-platform:完整提交哈希
```

然后执行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

恢复最新版时将 `APP_IMAGE` 改回 `:latest`。数据库结构变化可能无法仅靠回滚镜像撤销，升级前必须另存数据库备份。

## 十一、常见问题

### Nginx 返回 502

依次检查：

```bash
docker compose ps
docker compose logs --tail=200 app
docker exec NGINX_CONTAINER getent hosts test-platform
docker network inspect web
```

常见原因是 Nginx 与平台不在同一网络，或者 `.env` 中的 `PROXY_NETWORK` 写错。

### app 一直不健康

```bash
docker compose logs --tail=200 app
ls -ld data data/backups
```

若出现 `permission denied`：

```bash
chown -R 1000:1000 /data/universal-test-platform/data
docker compose restart app
```

### Nginx 找不到密码文件

检查 Nginx Compose 的挂载源路径和容器内路径是否一致：

```bash
docker exec NGINX_CONTAINER ls -l /etc/nginx/auth/test-platform.htpasswd
docker exec NGINX_CONTAINER nginx -t
```

不要把 `.htpasswd`、`.env`、SQLite 数据库或备份提交到 Git。
