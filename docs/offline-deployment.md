# 测试平台离线部署说明

适用场景：Linux 服务器无法访问 GitHub 或 GHCR，但可以通过 SFTP/FTP 接收文件。

离线包已经包含构建完成的 Linux AMD64 Docker 镜像。服务器不需要执行 `docker build`、下载 Node.js 基础镜像或安装 npm 依赖。

## 一、在电脑上下载离线包

1. 打开项目 GitHub 仓库的 `Actions` 页面。
2. 打开最新且状态为绿色的 `Build and publish Docker image`。
3. 在页面底部 `Artifacts` 区域下载 `offline-deployment-完整提交哈希`。
4. GitHub 下载得到一个 ZIP 文件，在 Windows 上解压。

解压后应包含：

```text
universal-test-platform-image.tar.gz
docker-compose.yml
env.example
nginx-test-platform.conf.example
OFFLINE-INSTALL.md
BUILD-INFO.txt
SHA256SUMS
```

离线包不包含 SQLite 数据库、备份、网站密码或 `.env`。

## 二、传到服务器

优先使用 WinSCP 的 SFTP：主机填写服务器 IP，端口填写 `22`，协议选择 `SFTP`。SFTP 使用 SSH 加密，不需要单独部署 FTP 服务。

在服务器创建目录：

```bash
mkdir -p /data/universal-test-platform
```

将解压后的全部文件上传到：

```text
/data/universal-test-platform/
```

如果只能使用传统 FTP，必须选择二进制传输模式；ASCII 模式可能破坏 `.tar.gz` 镜像文件。

## 三、校验上传文件

登录服务器后执行：

```bash
cd /data/universal-test-platform
sha256sum -c SHA256SUMS
```

所有文件都应显示 `OK`。若任何文件失败，不要继续安装，应重新上传失败文件。

## 四、导入 Docker 镜像

```bash
cd /data/universal-test-platform
docker load -i universal-test-platform-image.tar.gz
docker image ls ghcr.io/mai-mu/universal-test-platform
```

镜像列表中应同时出现 `latest` 和完整提交哈希标签。此过程只读取本地文件，不访问 GitHub。

## 五、接入现有 Nginx Docker 网络

查看 Nginx 容器名：

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

查看它所在的网络，将 `NGINX_CONTAINER` 替换成真实容器名：

```bash
docker inspect NGINX_CONTAINER --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}'
```

选择一个用户自定义 bridge 网络。若没有合适网络：

```bash
docker network create web
```

还需要在 Nginx 自己的 Compose 文件中把 Nginx 服务加入该外部网络，确保 Nginx 容器重建后仍保留连接。

## 六、配置平台

```bash
cd /data/universal-test-platform
cp env.example .env
nano .env
```

示例：

```dotenv
APP_IMAGE=ghcr.io/mai-mu/universal-test-platform:latest
PROXY_NETWORK=web
TZ=Asia/Shanghai
```

`PROXY_NETWORK` 必须填写 Nginx 实际加入的共享网络名。

准备持久化目录：

```bash
install -d -m 750 -o 1000 -g 1000 data data/backups
chmod 600 .env
```

如果需要迁移旧数据库，另外上传到：

```text
/data/universal-test-platform/data/testcases.db
```

再执行：

```bash
chown 1000:1000 data/testcases.db
chmod 640 data/testcases.db
```

## 七、离线启动

```bash
cd /data/universal-test-platform
docker compose config --quiet
docker compose up -d --pull never
docker compose ps
docker compose logs --tail=100 app
```

必须使用 `--pull never`，避免 Compose 尝试访问 GHCR。预期 `app` 最终变为 `healthy`。

平台没有向宿主机发布 3000 端口，只能由同一 Docker 网络中的 Nginx 通过以下地址访问：

```text
http://test-platform:3000
```

## 八、配置 Nginx

将 `nginx-test-platform.conf.example` 合并到现有 Nginx 配置：

- 修改 `server_name`；
- 保留 `resolver 127.0.0.11`；
- 保持上游为 `test-platform:3000`；
- 沿用现有 HTTPS 证书配置；
- 公网访问时保留 Basic Auth，因为平台没有内置登录。

配置完成后检查并平滑加载：

```bash
docker exec NGINX_CONTAINER nginx -t
docker exec NGINX_CONTAINER nginx -s reload
```

## 九、更新版本

每次 GitHub Actions 成功后会生成新的离线包。更新时：

1. 下载新离线包并校验；
2. 执行 `docker load -i universal-test-platform-image.tar.gz`；
3. 执行 `docker compose up -d --pull never`；
4. 检查容器健康状态和平台数据。

`data/` 不在镜像中，导入新镜像不会删除数据库。升级前仍应单独备份 `data/testcases.db`。
