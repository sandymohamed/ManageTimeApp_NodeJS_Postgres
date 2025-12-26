"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    async fetch(request, env, ctx) {
        return new Response(JSON.stringify({
            error: 'This app is not compatible with Cloudflare Workers',
            message: 'This Express app requires Socket.io, Prisma, and Redis which are not supported on Workers.',
            suggestion: 'Deploy to Railway, Render, Fly.io, or similar Node.js hosting platforms.'
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
//# sourceMappingURL=worker.js.map