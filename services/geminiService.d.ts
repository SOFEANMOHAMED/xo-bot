import { Product, BotPersona, AIProductDescriptionResponse, StorePolicies, Service, ChatMessage } from '../types';
export declare let PRODUCT_BOT_SYSTEM_PROMPT: string;
export declare let SERVICE_BOT_SYSTEM_PROMPT: string;
/**
 * Generates a response from the AI bot acting as a store assistant.
 */
export declare const generateStoreResponse: (chatHistory: ChatMessage[], products: Product[], baseSystemPrompt: string, storeName: string, storeCurrency: string, context?: "web" | "facebook_messenger" | "facebook_comment", persona?: BotPersona, policies?: StorePolicies) => Promise<string>;
/**
 * Generates a response from the SERVICE Bot using the enhanced sales prompt and full chat history.
 */
export declare const generateServiceResponse: (chatHistory: ChatMessage[], services: Service[], storeName: string) => Promise<string>;
/**
 * Generates a professional marketing description for a product.
 */
export declare const generateProductDescription: (productName: string, keywords: string, category: string, imageBase64?: string) => Promise<AIProductDescriptionResponse | null>;
/**
 * Handles the SaaS Platform Bots (Marketing & Support)
 */
export declare const generateSaaSAssistantResponse: (query: string, botType: "marketing" | "support") => Promise<string>;
/**
 * Generate Marketing Images
 */
export declare const generateMarketingImage: (prompt: string, aspectRatio?: "1:1" | "3:4" | "4:3" | "16:9" | "9:16", imageSize?: "1K" | "2K" | "4K", referenceImageBase64?: string) => Promise<string | null>;
//# sourceMappingURL=geminiService.d.ts.map