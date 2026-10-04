# NAS 端 CalDAV 服务：给荣耀/安卓系统日历原生订阅
#
# Radicale 是纯 Python 的 CalDAV 服务器（无第三方二进制依赖），
# 直接用宿主机已有的 python:3.12-alpine 装 pip 包，避免拉第三方镜像
# （NAS 上 Docker Hub 直连不通，只有 library/* 走国内源可用）。
FROM python:3.12-alpine

# 国内 PyPI 源，避免 pip 走官方源超时
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple radicale

EXPOSE 5232

# nobody（alpine 自带 uid 65534）运行，数据卷属主需宿主机侧对齐
USER 65534:65534
CMD ["radicale", "--config", "/config/config"]
