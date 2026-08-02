import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Updates the PRODUCT_BOT_SYSTEM_PROMPT or SERVICE_BOT_SYSTEM_PROMPT in geminiService.ts
 */
export const updateGeminiServicePrompt = async (
  botType: 'productsBot' | 'servicesBot',
  newSystemMessage: string
): Promise<void> => {
  try {
    // Path to geminiService.ts (from backend to services folder)
    const geminiServicePath = path.join(__dirname, '../../../../services/geminiService.ts');
    
    // Read the file
    let fileContent = fs.readFileSync(geminiServicePath, 'utf-8');
    
    // Escape backticks and backslashes in the message
    const escapedMessage = newSystemMessage
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`');
    
    if (botType === 'productsBot') {
      // Update PRODUCT_BOT_SYSTEM_PROMPT
      // Match: export let PRODUCT_BOT_SYSTEM_PROMPT = `...`;
      const productBotRegex = /(export let PRODUCT_BOT_SYSTEM_PROMPT = `)([\s\S]*?)(`;)/;
      
      if (productBotRegex.test(fileContent)) {
        fileContent = fileContent.replace(
          productBotRegex,
          `$1${escapedMessage}$3`
        );
      } else {
        throw new Error('PRODUCT_BOT_SYSTEM_PROMPT not found in geminiService.ts');
      }
    } else if (botType === 'servicesBot') {
      // Update SERVICE_BOT_SYSTEM_PROMPT
      // Match: export let SERVICE_BOT_SYSTEM_PROMPT = `...`;
      const serviceBotRegex = /(export let SERVICE_BOT_SYSTEM_PROMPT = `)([\s\S]*?)(`;)/;
      
      if (serviceBotRegex.test(fileContent)) {
        fileContent = fileContent.replace(
          serviceBotRegex,
          `$1${escapedMessage}$3`
        );
      } else {
        throw new Error('SERVICE_BOT_SYSTEM_PROMPT not found in geminiService.ts');
      }
    }
    
    // Write the updated content back to the file
    fs.writeFileSync(geminiServicePath, fileContent, 'utf-8');
    
    console.log(`Successfully updated ${botType} system message in geminiService.ts`);
  } catch (error: any) {
    console.error(`Error updating geminiService.ts:`, error);
    throw new Error(`Failed to update geminiService.ts: ${error.message}`);
  }
};

