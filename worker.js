const PREFIX = "/incr-ss-ark";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith(PREFIX)) {
      return new Response("Not found", { status: 404 });
    }

    // Ensure relative asset paths in index.html resolve under /incr-ss-ark/
    if (url.pathname === PREFIX) {
      url.pathname = `${PREFIX}/`;
      return Response.redirect(url.toString(), 301);
    }

    url.pathname = url.pathname.slice(PREFIX.length) || "/";

    let res = await env.ASSETS.fetch(new Request(url.toString(), request));

    // SPA fallback for deep links without file extensions
    if (res.status === 404 && !url.pathname.includes(".")) {
      url.pathname = "/index.html";
      res = await env.ASSETS.fetch(new Request(url.toString(), request));
    }

    return res;
  },
};
