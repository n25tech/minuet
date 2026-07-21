export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    
    const statement = context.env.DB.prepare(
      "INSERT INTO users (name) VALUES (?)"
    ).bind(body.name);

    const result = await statement.run();

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM users"
    ).run();

    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}