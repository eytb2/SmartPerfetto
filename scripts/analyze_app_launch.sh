#!/bin/bash

# SmartPerfetto App Launch Analysis Script
# 自动化分析应用启动性能的完整脚本

TRACE_FILE="${1:-Trace/app_launch.trace}"
APP_PACKAGE="${2:-com.example.androidappdemo}"
TRACE_PROCESSOR="../Perfetto-Tools/mac-arm64/trace_processor_shell"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           SmartPerfetto App Launch Performance Analysis${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Trace File:${NC} $TRACE_FILE"
echo -e "${GREEN}App Package:${NC} $APP_PACKAGE"
echo ""

# 检查文件是否存在
if [ ! -f "$TRACE_FILE" ]; then
    echo -e "${RED}Error: Trace file not found: $TRACE_FILE${NC}"
    exit 1
fi

if [ ! -f "$TRACE_PROCESSOR" ]; then
    echo -e "${RED}Error: Trace processor not found: $TRACE_PROCESSOR${NC}"
    exit 1
fi

# 1. 启动时间分析
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}1. 启动时间分析${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

QUERY1="SELECT slice.name AS phase, MIN(slice.ts) / 1e9 AS start_time_s, slice.dur / 1e6 AS duration_ms FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND (slice.name = 'activityStart' OR slice.name = 'activityResume') ORDER BY slice.ts ASC;"

echo "$QUERY1" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | grep -A 10 "phase"

echo ""
echo -e "${GREEN}总启动时间:${NC}"
QUERY1B="SELECT MIN(slice.ts) / 1e9 AS launch_start_s, MAX(slice.ts + slice.dur) / 1e9 AS launch_end_s, (MAX(slice.ts + slice.dur) - MIN(slice.ts)) / 1e6 AS total_launch_time_ms FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND (slice.name = 'activityStart' OR slice.name = 'activityResume');"

echo "$QUERY1B" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | grep -A 5 "launch_start_s"

# 2. 四大象限分析
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}2. 启动期间的四大象限分析 (Top 20 耗时操作)${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 首先获取启动时间范围
LAUNCH_START=$(echo "SELECT MIN(slice.ts) FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND slice.name = 'activityStart';" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | grep -E "^[0-9]" | head -1 | awk '{print $1}')

LAUNCH_END=$(echo "SELECT MAX(slice.ts + slice.dur) FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND slice.name = 'activityResume';" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | grep -E "^[0-9]" | head -1 | awk '{print $1}')

QUERY2="SELECT slice.name AS operation, slice.dur / 1e6 AS duration_ms, slice.ts / 1e9 AS timestamp_s, thread.name AS thread_name FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND slice.ts >= $LAUNCH_START AND slice.ts <= $LAUNCH_END AND slice.dur > 1000000 ORDER BY slice.dur DESC LIMIT 20;"

echo "$QUERY2" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | grep -A 25 "operation"

# 3. 主线程大小核分布
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}3. 主线程大小核分布${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

QUERY3="SELECT sched.cpu AS cpu_core, COUNT(*) AS run_count, SUM(sched.dur) / 1e6 AS total_time_ms, AVG(sched.dur) / 1e6 AS avg_time_ms FROM sched JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = '$APP_PACKAGE' AND thread.is_main_thread = 1 AND sched.ts >= $LAUNCH_START AND sched.ts <= $LAUNCH_END GROUP BY sched.cpu ORDER BY sched.cpu;"

echo "$QUERY3" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | grep -A 15 "cpu_core"

# 4. CPU频率分布
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}4. 启动期间CPU频率分布${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

QUERY4="SELECT counter_track.name, AVG(counter.value) / 1000000 AS avg_freq_ghz, MIN(counter.value) / 1000000 AS min_freq_ghz, MAX(counter.value) / 1000000 AS max_freq_ghz FROM counter JOIN counter_track ON counter.track_id = counter_track.id WHERE counter_track.name LIKE 'cpufreq%' AND counter.ts >= $LAUNCH_START AND counter.ts <= $LAUNCH_END GROUP BY counter_track.name ORDER BY counter_track.name;"

echo "$QUERY4" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | grep -A 10 "name"

# 5. CPU负载分析
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}5. 启动期间各CPU核心负载${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 计算时间窗口大小
WINDOW_NS=$((LAUNCH_END - LAUNCH_START))
WINDOW_MS=$(echo "scale=2; $WINDOW_NS / 1000000" | bc)

QUERY5="SELECT cpu AS cpu_core, COUNT(*) AS total_schedules, SUM(dur) / 1e6 AS total_run_time_ms, (SUM(dur) * 100.0 / $WINDOW_NS) AS utilization_percent FROM sched WHERE ts >= $LAUNCH_START AND ts <= $LAUNCH_END GROUP BY cpu ORDER BY cpu;"

echo "$QUERY5" | $TRACE_PROCESSOR "$TRACE_FILE" 2>&1 | grep -A 15 "cpu_core"

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}所有的启动信息都分析完成${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════════════════════${NC}
"
