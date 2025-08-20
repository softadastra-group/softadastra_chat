// __tests__/helpers/feed.e2e.test.js
require("dotenv").config({ path: ".env.test" });

const request = require("supertest");
const db = require("../../db/mysql");
const { buildTestApp } = require("./testApp");
const { schemaSQL, truncateSQL } = require("./schema");
const { runSchema } = require("./schemaRunner");

const app = buildTestApp();
const AUTH_HEADER = { "x-user-id": "1" }; // on force un user en test

// (optionnel) si MySQL met un peu de temps
jest.setTimeout(20000);

beforeAll(async () => {
  // Crée les tables si non existantes (une requête par statement)
  await runSchema(schemaSQL);
});

beforeEach(async () => {
  // Nettoyage des tables
  await runSchema(truncateSQL);
});

afterAll(async () => {
  try {
    await db.pool.end();
  } catch {}
});

describe("Feed API", () => {
  test("POST /api/feed/text -> crée un post texte seul", async () => {
    const res = await request(app)
      .post("/api/feed/text")
      .set(AUTH_HEADER)
      .send({ body: "Bonjour Softadastra!", visibility: "public" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.id).toBe("number");

    const id = res.body.id;

    // Vérifie lecture
    const show = await request(app).get(`/api/feed/${id}`);
    expect(show.status).toBe(200);
    expect(show.body.success).toBe(true);
    expect(show.body.post.body).toBe("Bonjour Softadastra!");
    expect(show.body.post.media).toEqual([]);
  });

  test("POST /api/feed/photo -> crée un post photo seul (1+ images)", async () => {
    const res = await request(app)
      .post("/api/feed/photo")
      .set(AUTH_HEADER)
      .send({
        image_urls: ["/uploads/abc.jpg", "/uploads/def.png"],
        sizes: [
          { width: 800, height: 600, mime_type: "image/jpeg" },
          { width: 512, height: 512, mime_type: "image/png" },
        ],
        visibility: "public",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const id = res.body.id;

    const show = await request(app).get(`/api/feed/${id}`);
    expect(show.status).toBe(200);
    expect(show.body.post.body).toBe(null);
    expect(show.body.post.media_count).toBe(2);
    expect(show.body.post.media.length).toBe(2);
    expect(show.body.post.media[0].url).toBe("/uploads/abc.jpg");
  });

  test("GET /api/feed -> liste paginée", async () => {
    // seed: 1 texte, 1 photo
    await request(app)
      .post("/api/feed/text")
      .set(AUTH_HEADER)
      .send({ body: "post A" });
    await request(app)
      .post("/api/feed/photo")
      .set(AUTH_HEADER)
      .send({ image_urls: ["/img1.jpg"] });

    const list = await request(app).get("/api/feed").query({ limit: 10 });
    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.items.length).toBe(2);
  });

  test("POST /api/feed/:id/like & DELETE /api/feed/:id/like", async () => {
    const create = await request(app)
      .post("/api/feed/text")
      .set(AUTH_HEADER)
      .send({ body: "like me!" });
    const id = create.body.id;

    const like = await request(app)
      .post(`/api/feed/${id}/like`)
      .set(AUTH_HEADER);
    expect(like.status).toBe(200);
    expect(like.body.success).toBe(true);
    expect(like.body.likes_count).toBe(1);

    // idempotent (re-like ne change pas le count au-delà de 1)
    const like2 = await request(app)
      .post(`/api/feed/${id}/like`)
      .set(AUTH_HEADER);
    expect(like2.body.likes_count).toBe(1);

    const unlike = await request(app)
      .delete(`/api/feed/${id}/like`)
      .set(AUTH_HEADER);
    expect(unlike.status).toBe(200);
    expect(unlike.body.likes_count).toBe(0);
  });

  test("DELETE /api/feed/:id -> soft delete", async () => {
    const create = await request(app)
      .post("/api/feed/text")
      .set(AUTH_HEADER)
      .send({ body: "delete me" });
    const id = create.body.id;

    const del = await request(app).delete(`/api/feed/${id}`).set(AUTH_HEADER);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const show = await request(app).get(`/api/feed/${id}`);
    expect(show.status).toBe(404);
  });

  test("erreurs de validation: /text sans body", async () => {
    const res = await request(app)
      .post("/api/feed/text")
      .set(AUTH_HEADER)
      .send({ body: "" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("erreurs de validation: /photo sans images", async () => {
    const res = await request(app)
      .post("/api/feed/photo")
      .set(AUTH_HEADER)
      .send({ image_urls: [] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("401 si pas authentifié", async () => {
    const res = await request(app)
      .post("/api/feed/text")
      .send({ body: "no auth" });
    expect(res.status).toBe(401);
  });

  test("POST /api/feed/:id/reply/text -> crée une reply texte", async () => {
    // parent
    const parent = await request(app)
      .post("/api/feed/text")
      .set(AUTH_HEADER)
      .send({ body: "parent" });
    const pid = parent.body.id;

    const rep = await request(app)
      .post(`/api/feed/${pid}/reply/text`)
      .set({ "x-user-id": "2" })
      .send({ body: "reply!" });

    expect(rep.status).toBe(200);
    expect(rep.body.success).toBe(true);

    // list
    const list = await request(app)
      .get(`/api/feed/${pid}/replies`)
      .query({ limit: 10 });
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(1);

    // parent compteur
    const showParent = await request(app).get(`/api/feed/${pid}`);
    expect(showParent.body.post.replies_count).toBe(1);
  });

  test("POST /api/feed/:id/reply/photo -> crée une reply photo", async () => {
    const parent = await request(app)
      .post("/api/feed/text")
      .set(AUTH_HEADER)
      .send({ body: "parent 2" });
    const pid = parent.body.id;

    const repPhoto = await request(app)
      .post(`/api/feed/${pid}/reply/photo`)
      .set({ "x-user-id": "2" })
      .send({ image_urls: ["/uploads/r.png"] });

    expect(repPhoto.status).toBe(200);

    const list = await request(app).get(`/api/feed/${pid}/replies`);
    expect(list.body.items[0].media_count).toBe(1);
  });

  test("DELETE reply -> décrémente replies_count du parent (si patch appliqué)", async () => {
    const parent = await request(app)
      .post("/api/feed/text")
      .set(AUTH_HEADER)
      .send({ body: "parent 3" });
    const pid = parent.body.id;

    const rep = await request(app)
      .post(`/api/feed/${pid}/reply/text`)
      .set({ "x-user-id": "2" })
      .send({ body: "to delete" });
    const rid = rep.body.id;

    // delete par le propriétaire "2"
    const del = await request(app)
      .delete(`/api/feed/${rid}`)
      .set({ "x-user-id": "2" });
    expect(del.status).toBe(200);

    const showParent = await request(app).get(`/api/feed/${pid}`);
    expect(showParent.body.post.replies_count).toBe(0);
  });
});
