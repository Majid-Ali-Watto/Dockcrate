import { apiRoute, handleGenerate } from '../../../src/api.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 10; // generation is pure and fast; cap runaway requests on the hosted site
export const POST = apiRoute(handleGenerate);
