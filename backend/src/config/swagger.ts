import swaggerJsdoc from 'swagger-jsdoc';
import { SwaggerDefinition } from 'swagger-jsdoc';

const swaggerDefinition: SwaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Al-Musaid API',
    version: '1.0.0',
    description: 'API Documentation for Al-Musaid Arabic AI Product Assistant',
    contact: {
      name: 'API Support',
      email: 'support@almusaid.com'
    }
  },
  servers: [
    {
      url: process.env.BACKEND_URL || 'https://xo-bot.com',
      description: 'Production server'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false
          },
          error: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                example: 'Error message'
              },
              code: {
                type: 'string',
                example: 'ERROR_CODE'
              }
            }
          }
        }
      },
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid'
          },
          email: {
            type: 'string',
            format: 'email'
          },
          name: {
            type: 'string',
            nullable: true
          },
          subscriptionPlan: {
            type: 'string',
            enum: ['trial', 'comments', 'single', 'social', 'yearly', 'starter', 'pro', 'business']
          },
          subscriptionStatus: {
            type: 'string',
            enum: ['active', 'suspended', 'expired']
          },
          trialEndsAt: {
            type: 'string',
            format: 'date-time',
            nullable: true
          },
          createdAt: {
            type: 'string',
            format: 'date-time'
          }
        }
      },
      Product: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid'
          },
          merchantId: {
            type: 'string',
            format: 'uuid'
          },
          name: {
            type: 'string'
          },
          description: {
            type: 'string',
            nullable: true
          },
          price: {
            type: 'number',
            format: 'decimal'
          },
          currency: {
            type: 'string',
            default: 'SAR'
          },
          category: {
            type: 'string',
            nullable: true
          },
          stock: {
            type: 'integer',
            default: 0
          },
          imageUrl: {
            type: 'string',
            nullable: true
          },
          createdAt: {
            type: 'string',
            format: 'date-time'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time'
          }
        }
      }
    }
  },
  tags: [
    {
      name: 'Authentication',
      description: 'Authentication endpoints'
    },
    {
      name: 'Products',
      description: 'Product management endpoints'
    },
    {
      name: 'Orders',
      description: 'Order management endpoints'
    },
    {
      name: 'AI',
      description: 'AI chat endpoints'
    },
    {
      name: 'Admin',
      description: 'Admin panel endpoints'
    },
    {
      name: 'CRM',
      description: 'Customer relationship management endpoints'
    },
    {
      name: 'Analytics',
      description: 'Analytics and reporting endpoints'
    }
  ]
};

const options = {
  definition: swaggerDefinition,
  apis: [
    './src/routes/*.ts',
    './src/controllers/*.ts'
  ]
};

export const swaggerSpec = swaggerJsdoc(options);

