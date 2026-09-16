import html from '../publish/retention/index.html';

export default {
  async fetch(request) {
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  },
};
