// 用项目自带 esbuild 打包验证脚本后在 Node 中运行，避免额外引入 ts 运行时依赖。
const path = require('path')
const esbuild = require('esbuild')

const outfile = path.join(__dirname, '..', 'node_modules', '.verify-workflow.cjs')

esbuild
  .build({
    entryPoints: [path.join(__dirname, 'verify-workflow.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'warning',
  })
  .then(() => {
    require(outfile)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
