/**
 * Smart Pipeline - SalesGPT-only merchant bot path
 */

export {
  processWithSalesGPT as processSmartPipeline,
  type SalesGPTPipelineInput as SmartPipelineInput,
  type SalesGPTPipelineResult as SmartPipelineResult
} from '../../services/salesgpt/index.js';
