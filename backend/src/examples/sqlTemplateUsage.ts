/**
 * SQL模板引擎使用示例
 * 展示如何在实际项目中使用SQL模板引擎
 */

import { SQLTemplateEngine } from '../services/sqlTemplateEngine';

// ============================================================================
// 示例 1: 基本使用 - 使用模板生成SQL
// ============================================================================
function example1_BasicUsage() {
  console.log('=== 示例1: 基本使用 ===\n');

  const engine = new SQLTemplateEngine();

  // 渲染启动时间查询
  const sql = engine.render('APP_LAUNCH_TIME', {
    app_package: 'com.example.androidappdemo'
  });

  console.log('生成的SQL:');
  console.log(sql);
  console.log('\n');
}

// ============================================================================
// 示例 2: 智能匹配 - 根据用户输入自动选择模板
// ============================================================================
function example2_SmartMatch() {
  console.log('=== 示例2: 智能匹配 ===\n');

  const engine = new SQLTemplateEngine();

  const userQueries = [
    '分析com.example.app的启动时间',
    '查看主线程的CPU核心分布',
    '获取CPU频率信息',
    '找出最耗时的操作'
  ];

  userQueries.forEach(query => {
    const template = engine.matchTemplate(query);
    if (template) {
      console.log(`用户查询: "${query}"`);
      console.log(`匹配模板: ${template.name}`);
      console.log(`描述: ${template.description}`);
      console.log(`需要参数: ${template.params.join(', ')}`);
      console.log('---');
    }
  });
  console.log('\n');
}

// ============================================================================
// 示例 3: SQL验证 - 检查SQL的正确性
// ============================================================================
function example3_Validation() {
  console.log('=== 示例3: SQL验证 ===\n');

  const engine = new SQLTemplateEngine();

  // 测试各种SQL
  const testCases = [
    {
      name: '正确的SQL',
      sql: `SELECT slice.name, slice.dur / 1e6 AS duration_ms FROM slice JOIN thread_track ON slice.track_id = thread_track.id JOIN thread USING (utid) JOIN process USING (upid) WHERE process.name = 'com.example.app' ORDER BY slice.dur DESC LIMIT 10;`
    },
    {
      name: '错误的表名',
      sql: `SELECT * FROM app_launch WHERE name = 'test';`
    },
    {
      name: '缺少时间单位转换',
      sql: `SELECT ts, dur FROM slice WHERE dur > 1000;`
    },
    {
      name: 'counter表错误使用cpu字段',
      sql: `SELECT cpu, value FROM counter WHERE cpu = 0;`
    }
  ];

  testCases.forEach(test => {
    console.log(`测试: ${test.name}`);
    const result = engine.validateSQL(test.sql);

    console.log(`  是否有效: ${result.isValid ? '✓' : '✗'}`);

    if (result.errors.length > 0) {
      console.log(`  错误:`);
      result.errors.forEach(err => console.log(`    - ${err}`));
    }

    if (result.warnings.length > 0) {
      console.log(`  警告:`);
      result.warnings.forEach(warn => console.log(`    - ${warn}`));
    }

    if (result.suggestions.length > 0) {
      console.log(`  建议:`);
      result.suggestions.forEach(sug => console.log(`    - ${sug}`));
    }

    console.log('');
  });
}

// ============================================================================
// 示例 4: 错误修正 - 自动修正常见错误
// ============================================================================
function example4_AutoFix() {
  console.log('=== 示例4: 错误修正 ===\n');

  const engine = new SQLTemplateEngine();

  const wrongSQL = `SELECT * FROM app_launch WHERE ts > 1000;`;

  console.log('原始SQL (错误):');
  console.log(wrongSQL);
  console.log('');

  const validation = engine.validateSQL(wrongSQL);
  console.log('验证结果:');
  console.log(`  错误: ${validation.errors.join(', ')}`);
  console.log('');

  const fixed = engine.suggestFix(wrongSQL, validation.errors[0]);
  if (fixed) {
    console.log('修正后的SQL:');
    console.log(fixed);
  } else {
    console.log('无法自动修正，需要手动处理');
  }
  console.log('\n');
}

// ============================================================================
// 示例 5: 完整工作流 - 从用户输入到SQL执行
// ============================================================================
async function example5_CompleteWorkflow() {
  console.log('=== 示例5: 完整工作流 ===\n');

  const engine = new SQLTemplateEngine();

  // 步骤1: 用户输入
  const userRequest = '分析com.example.androidappdemo的启动时间';
  console.log(`步骤1 - 用户输入: "${userRequest}"`);
  console.log('');

  // 步骤2: 匹配模板
  const template = engine.matchTemplate(userRequest);
  if (!template) {
    console.log('❌ 没有找到匹配的模板');
    return;
  }

  console.log(`步骤2 - 匹配到模板: ${template.name}`);
  console.log(`描述: ${template.description}`);
  console.log('');

  // 步骤3: 提取参数
  // 在实际应用中，这里应该使用NLP或正则提取参数
  const params = {
    app_package: 'com.example.androidappdemo'
  };

  console.log('步骤3 - 提取参数:');
  console.log(JSON.stringify(params, null, 2));
  console.log('');

  // 步骤4: 渲染SQL
  const sql = engine.render(template.name, params);
  console.log('步骤4 - 生成SQL:');
  console.log(sql);
  console.log('');

  // 步骤5: 验证SQL
  const validation = engine.validateSQL(sql);
  console.log('步骤5 - 验证SQL:');
  console.log(`  有效性: ${validation.isValid ? '✓ 通过' : '✗ 失败'}`);

  if (validation.warnings.length > 0) {
    console.log('  警告:');
    validation.warnings.forEach(w => console.log(`    - ${w}`));
  }

  if (validation.suggestions.length > 0) {
    console.log('  建议:');
    validation.suggestions.forEach(s => console.log(`    - ${s}`));
  }
  console.log('');

  // 步骤6: 执行SQL (这里模拟)
  console.log('步骤6 - 执行SQL (模拟)');
  console.log('  ✓ SQL已发送到trace_processor');
  console.log('  ✓ 查询执行成功');
  console.log('  ✓ 返回结果: ...');
  console.log('\n');
}

// ============================================================================
// 示例 6: 批量分析 - 使用多个模板进行完整分析
// ============================================================================
function example6_BatchAnalysis() {
  console.log('=== 示例6: 批量分析 ===\n');

  const engine = new SQLTemplateEngine();
  const appPackage = 'com.example.androidappdemo';
  const startTs = '40919970000000';
  const endTs = '40920200000000';

  // 定义分析流程
  const analysisSteps = [
    {
      title: '1. 启动时间分析',
      template: 'APP_LAUNCH_TIME',
      params: { app_package: appPackage }
    },
    {
      title: '2. 总启动时间',
      template: 'TOTAL_LAUNCH_TIME',
      params: { app_package: appPackage }
    },
    {
      title: '3. Top耗时操作',
      template: 'TOP_OPERATIONS',
      params: {
        app_package: appPackage,
        start_ts: startTs,
        end_ts: endTs,
        min_duration_ns: '1000000',
        limit: '20'
      }
    },
    {
      title: '4. 主线程CPU分布',
      template: 'MAIN_THREAD_CPU_DISTRIBUTION',
      params: {
        app_package: appPackage,
        start_ts: startTs,
        end_ts: endTs
      }
    },
    {
      title: '5. CPU频率分布',
      template: 'CPU_FREQUENCY_DISTRIBUTION',
      params: {
        start_ts: startTs,
        end_ts: endTs
      }
    },
    {
      title: '6. CPU负载',
      template: 'CPU_LOAD',
      params: {
        start_ts: startTs,
        end_ts: endTs,
        window_ns: '230000000'
      }
    }
  ];

  console.log(`应用: ${appPackage}`);
  console.log(`时间范围: ${startTs} - ${endTs}`);
  console.log('');

  analysisSteps.forEach(step => {
    console.log(step.title);
    try {
      const sql = engine.render(step.template, step.params);
      const validation = engine.validateSQL(sql);

      if (validation.isValid) {
        console.log('  ✓ SQL生成成功');
        console.log(`  模板: ${step.template}`);
        // console.log(`  SQL: ${sql.substring(0, 100)}...`);
      } else {
        console.log('  ✗ SQL验证失败');
        console.log(`  错误: ${validation.errors.join(', ')}`);
      }
    } catch (error: any) {
      console.log(`  ✗ 错误: ${error.message}`);
    }
    console.log('');
  });
}

// ============================================================================
// 示例 7: 与现有AI服务集成
// ============================================================================
function example7_AIIntegration() {
  console.log('=== 示例7: 与AI服务集成 ===\n');

  const engine = new SQLTemplateEngine();

  console.log('集成流程:');
  console.log('');

  console.log('1. 用户输入 → AI服务');
  console.log('   用户: "分析应用启动性能"');
  console.log('');

  console.log('2. AI服务 → 尝试模板匹配');
  const template = engine.matchTemplate('分析应用启动性能');
  if (template) {
    console.log(`   ✓ 匹配到模板: ${template.name}`);
    console.log('   → 使用模板（快速、可靠）');
  } else {
    console.log('   ✗ 未匹配到模板');
    console.log('   → 调用LLM生成SQL（灵活、可能不准确）');
  }
  console.log('');

  console.log('3. 生成SQL → 验证器');
  console.log('   → 检查语法、表名、JOIN关系');
  console.log('');

  console.log('4. 验证失败 → 修正器');
  console.log('   → 尝试自动修正');
  console.log('   → 如果无法修正，返回错误给AI重新生成');
  console.log('');

  console.log('5. 验证通过 → 执行SQL');
  console.log('   → 调用trace_processor');
  console.log('   → 返回结果给用户');
  console.log('');

  console.log('优势:');
  console.log('  • 模板方式: 快速、准确、可预测');
  console.log('  • AI生成方式: 灵活、能处理复杂查询');
  console.log('  • 验证器: 确保SQL正确性');
  console.log('  • 修正器: 自动修复常见错误');
  console.log('\n');
}

// ============================================================================
// 运行所有示例
// ============================================================================
function runAllExamples() {
  example1_BasicUsage();
  example2_SmartMatch();
  example3_Validation();
  example4_AutoFix();
  example5_CompleteWorkflow();
  example6_BatchAnalysis();
  example7_AIIntegration();

  console.log('='.repeat(80));
  console.log('所有示例执行完成');
  console.log('='.repeat(80));
}

// 如果直接运行此文件
if (require.main === module) {
  runAllExamples();
}

export {
  example1_BasicUsage,
  example2_SmartMatch,
  example3_Validation,
  example4_AutoFix,
  example5_CompleteWorkflow,
  example6_BatchAnalysis,
  example7_AIIntegration,
  runAllExamples
};
