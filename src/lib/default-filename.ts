import { exists } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from './workspace'

/**
 * 生成唯一的默认文件名
 * @param parentPath 父目录路径，空字符串表示根目录
 * @param baseName 基础文件名，默认为 "Untitled"
 * @returns 唯一的文件名（包含.md扩展名）
 */
export async function generateUniqueFilename(parentPath: string = '', baseName: string = 'Untitled'): Promise<string> {
  const workspace = await getWorkspacePath()
  
  // 构建基础文件名
  let filename = `${baseName}.md`
  let counter = 0
  
  while (true) {
    // 构建完整的相对路径
    const fullRelativePath = parentPath ? `${parentPath}/${filename}` : filename
    const pathOptions = await getFilePathOptions(fullRelativePath)
    
    // 检查文件是否存在
    let fileExists = false
    try {
      if (workspace.isCustom) {
        fileExists = await exists(pathOptions.path)
      } else {
        fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      // 如果检查失败，假设文件不存在
      fileExists = false
    }
    
    if (!fileExists) {
      return filename
    }
    
    // 文件存在，生成下一个候选名称
    counter++
    filename = `${baseName} (${counter}).md`
  }
}

