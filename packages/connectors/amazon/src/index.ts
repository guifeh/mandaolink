export { parseProductHtml, parsePriceCents, parseCoupon, detectBlock, type Product, type Cupom, type BlockKind } from './parse.ts';
export {
  createFetchReader,
  createBrowserReader,
  createAmazonReader,
  type ProductReader,
  type ReadResult,
  type ReadFailure,
} from './reader.ts';
