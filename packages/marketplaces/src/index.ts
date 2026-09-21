export * from './adapter';
export * from './shopee/signature';
export * from './shopee/client';
export * from './shopee/mapper';
export * from './shopee/adapter';
export * from './tag-adapter';
export * from './registry';
export * from './scrapers';
export * from './mercadolivre/official-link';
export { AmazonSessionError, generateOfficialAmazonLink, findFirstUrl } from './amazon/official-link';
export {
  AmazonApiError,
  getAccessToken,
  getItems,
  extractAsin,
  mapCreatorsApiItem,
  type AmazonApiCredentials,
  type AmazonApiItem,
  type AmazonApiOptions,
} from './amazon/creators-api';
