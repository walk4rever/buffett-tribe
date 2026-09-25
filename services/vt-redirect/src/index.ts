const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const target = `https://vt.air7.fun${url.pathname}${url.search}`;
    return Response.redirect(target, 301);
  },
};

export default worker;
