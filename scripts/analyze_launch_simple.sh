#!/bin/bash

# SmartPerfetto 简化版应用启动分析脚本
# 直接使用固定的时间窗口进行分析

TRACE_FILE="${1:-../Trace/app_launch.trace}"
APP_PACKAGE="${2:-com.example.androidappdemo}"
TRACE_PROCESSOR="../Perfetto-Tools/mac-arm64/trace_processor_shell"

# 基于实际分析的启动时间窗口 (纳秒)
LAUNCH_START="40919970000000"
LAUNCH_END="40920200000000"

# 颜色
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    SmartPerfetto App Launch Performance Analysis${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}应用包名:${NC} $APP_PACKAGE"
echo -e "${GREEN}Trace文件:${NC} $TRACE_FILE"
echo ""

# 1. 启动时间分析
echo -e "${YELLOW}━━━ 1. 启动时间分析 ━━━${NC}"
echo "SELECT slice.name AS 阶段, MIN(slice.ts) / 1e9 AS 开始时间_s, slice.dur / 1e6 AS 耗时_ms FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND (slice.name = 'activityStart' OR slice.name = 'activityResume') ORDER BY slice.ts ASC;" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | tail -6

echo ""
echo "总启动时间:"
echo "SELECT MIN(slice.ts) / 1e9 AS 开始_s, MAX(slice.ts + slice.dur) / 1e9 AS 结束_s, (MAX(slice.ts + slice.dur) - MIN(slice.ts)) / 1e6 AS 总耗时_ms FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND (slice.name = 'activityStart' OR slice.name = 'activityResume');" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | tail -6

# 2. 四大象限
echo ""
echo -e "${YELLOW}━━━ 2. 启动期间的四大象限 (Top 20 耗时操作) ━━━${NC}"
echo "SELECT slice.name AS 操作, slice.dur / 1e6 AS 耗时_ms, slice.ts / 1e9 AS 时间戳_s, thread.name AS 线程 FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND slice.ts >= $LAUNCH_START AND slice.ts <= $LAUNCH_END AND slice.dur > 1000000 ORDER BY slice.dur DESC LIMIT 20;" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | tail -30

# 3. 主线程核心分布
echo ""
echo -e "${YELLOW}━━━ 3. 主线程大小核分布 ━━━${NC}"
echo "SELECT sched.cpu AS CPU核心, COUNT(*) AS 调度次数, SUM(sched.dur) / 1e6 AS 总运行时间_ms, AVG(sched.dur) / 1e6 AS 平均运行时间_ms FROM sched JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND thread.is_main_thread = 1 AND sched.ts >= $LAUNCH_START AND sched.ts <= $LAUNCH_END GROUP BY sched.cpu ORDER BY sched.cpu;" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | tail -15

# 4. CPU频率
echo ""
echo -e "${YELLOW}━━━ 4. 启动期间CPU频率分布 ━━━${NC}"
echo "SELECT counter_track.name AS CPU, AVG(counter.value) / 1000000 AS 平均频率_GHz, MIN(counter.value) / 1000000 AS 最低频率_GHz, MAX(counter.value) / 1000000 AS 最高频率_GHz FROM counter JOIN counter_track ON counter.track_id = counter_track.id WHERE counter_track.name LIKE 'cpufreq%' AND counter.ts >= $LAUNCH_START AND counter.ts <= $LAUNCH_END GROUP BY counter_track.name ORDER BY counter_track.name;" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | tail -10

# 5. CPU负载
echo ""
echo -e "${YELLOW}━━━ 5. 启动期间各CPU核心负载 ━━━${NC}"
echo "SELECT cpu AS CPU核心, COUNT(*) AS 调度总次数, SUM(dur) / 1e6 AS 总运行时间_ms, ROUND((SUM(dur) * 100.0 / 230000000.0), 2) AS 利用率_percent FROM sched WHERE ts >= $LAUNCH_START AND ts <= $LAUNCH_END GROUP BY cpu ORDER BY cpu;" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | tail -15

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}所有的启动信息都分析完成${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
