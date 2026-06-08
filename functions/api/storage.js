export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  console.log(url);
  console.log(env);
//  if (request.method === "GET") {}
//if (request.method === "POST") {
//    try {
//      const { key, value } = await request.json();
//      const stringifiedValue = JSON.stringify(value);

}
