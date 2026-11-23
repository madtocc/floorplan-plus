// UML model (graph.uml): classes with what each is handed, the calls their methods make, the data model
// (Prisma and Drizzle), and tsoa controllers as the home of their endpoints, with Health reading @Security.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { SKILL, lib, makeProject, scanAndBuild, readGraph, routeKeys, openEndpoints, cleanup } from './helpers.mjs';

const { blank, classesIn, prismaModels, drizzleTables } = await lib('uml.mjs');
const { extract } = await lib('extract.mjs');

const CONTROLLER = `import { Body, Controller, Get, Middlewares, NoSecurity, Path, Post, Response, Route, Security } from 'tsoa'
import { inject, injectable } from 'inversify'
import { OrderService } from './order.service'
import { validateSchema } from '../middleware/validation'

@injectable()
@Route('orders')
export class OrderController extends Controller {
  constructor(@inject(OrderService.name) private readonly _orderService: OrderService) {
    super()
  }

  @Get('{orderId}')
  @Security('jwt')
  @Response<ApiResponse<null>>(401, 'Unauthorized')
  public async getOrder(@Path() orderId: string): Promise<Order> {
    return this._orderService.getOrder(orderId)
  }

  @Post()
  @Security('jwt')
  @Middlewares([
    validateSchema(createOrderSchema, { stripUnknown: true })
  ])
  @Response<ApiResponse<null>>(400, 'Bad request')
  public async createOrder(@Body() body: CreateOrderDto): Promise<Order> {
    return this._orderService.createOrder(body)
  }

  @Get('health/ping')
  @NoSecurity()
  public async ping(): Promise<string> {
    return 'pong'
  }
}
`;

const SERVICE = `import { inject, injectable } from 'inversify'
import { OrderRepository } from './order.repository'
import { MAILER, IMailer } from './mailer.port'
import { LoggerService } from './logger.service'

/** Orders: read and place. */
@injectable()
export class OrderService extends BaseService {
  // const fake = 'class Ghost { }'
  private retries = 3
  static readonly KIND: string = 'order'

  constructor(
    @inject(OrderRepository.name) private readonly _orders: OrderRepository,
    @inject(MAILER) private readonly _mailer: IMailer,
    @inject(LoggerService.name) private readonly _logger: LoggerService
  ) {
    super()
  }

  public async getOrder(id: string): Promise<Order | null> {
    this._logger.info('reading', { id })
    return this._orders.findById(id)
  }

  public async createOrder(
    body: CreateOrderDto,
    options: { notify: boolean } = { notify: true }
  ): Promise<Order> {
    const order = await this._orders.insert(body)
    await this._notify(order)
    this._format(order)
    return order
  }

  private async _notify(order: Order): Promise<void> {
    await this._mailer.send(order.email, \`Order \${order.id} { placed }\`)
  }

  private _format(order: Order): string {
    return String(order.id)
  }
}
`;

const REPOSITORY = `import { inject, injectable } from 'inversify'
import { PrismaProvider } from './prisma.provider'

@injectable()
export class OrderRepository {
  constructor(@inject(PrismaProvider.name) private readonly _prisma: PrismaProvider) {}

  async findById(id: string) {
    return this._prisma.client.order.findUnique({ where: { id } })
  }

  async insert(data: unknown) {
    await this._prisma.client.orderItem.createMany({ data: [] })
    return this._prisma.client.order.create({ data })
  }
}
`;

const MAILER_PORT = `export const MAILER = Symbol.for('Mailer')
export interface IMailer {
  send(to: string, text: string): Promise<void>
}
export interface OrderDto { id: string }
`;

const MAILER = `import { injectable } from 'inversify'
import { IMailer } from './mailer.port'

@injectable()
export class SesMailer implements IMailer {
  async send(to: string, text: string): Promise<void> {}
}
export class MailError extends Error {}
`;

const CONTAINER = `import { Container } from 'inversify'
import { MAILER, IMailer } from './mailer.port'
import { SesMailer } from './mailer'
export const container = new Container()
container.bind<IMailer>(MAILER).to(SesMailer)
`;

const GENERATED = `/* tslint:disable */
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file
import { fetchMiddlewares } from '@tsoa/runtime';
import { OrderController } from './../orders/order.controller';
export function RegisterRoutes(app: Router) {
        app.get('/api/v1/orders/:orderId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(OrderController)),
            ...(fetchMiddlewares<RequestHandler>(OrderController.prototype.getOrder)),
            async function OrderController_getOrder(request: ExRequest, response: ExResponse, next: any) {
            });
        app.post('/api/v1/orders',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(OrderController)),
            ...(fetchMiddlewares<RequestHandler>(OrderController.prototype.createOrder)),
            async function OrderController_createOrder(request: ExRequest, response: ExResponse, next: any) {
            });
        app.get('/api/v1/orders/health/ping',
            ...(fetchMiddlewares<RequestHandler>(OrderController)),
            ...(fetchMiddlewares<RequestHandler>(OrderController.prototype.ping)),
            async function OrderController_ping(request: ExRequest, response: ExResponse, next: any) {
            });
}
`;

const PRISMA = `model Order {
  id         String      @id
  customer_id String
  note       String?     // free text
  customer   Customer    @relation(fields: [customer_id], references: [id])
  items      OrderItem[]
  receipt    Receipt?
  tags       Tag[]

  @@map("orders")
  @@schema("sales")
}

model OrderItem {
  order_id String
  sku      String
  qty      Int    @default(1)
  order    Order  @relation(fields: [order_id], references: [id])

  @@id([order_id, sku])
}

model Customer {
  id     String  @id
  email  String  @unique
  orders Order[]
}

model Receipt {
  id       String @id
  order_id String @unique
  order    Order  @relation(fields: [order_id], references: [id])
}

model Tag {
  id     String  @id
  orders Order[]
}

enum Status {
  open
  paid
}
`;

const DRIZZLE = `import { pgTable, uuid, text, integer } from 'drizzle-orm/pg-core'

export const clubs = pgTable('clubs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
})

export const players = pgTable('players', {
  id: uuid('id').primaryKey(),
  clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  nickname: text('nickname'),
  number: integer('shirt_number').notNull(),
})
`;

test('blank() wipes comments and strings but keeps positions and the code inside ${}', () => {
  const src = 'const a = "x { y"; // } gone\nconst b = `t ${ fn({ k: 1 }) } u`; /* { */ call()';
  const out = blank(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(!out.includes('gone') && !out.includes('x { y'));
  assert.ok(out.includes('fn({ k: 1 })'), 'template expressions are code');
  assert.ok(out.includes('call()'));
  assert.equal((out.match(/[{}]/g) || []).length, 2, 'only the object literal inside ${} keeps its braces');
});

test('classes: members, visibility, what the constructor is handed, and calls in order', () => {
  const [svc] = classesIn(SERVICE);
  assert.equal(svc.name, 'OrderService');
  assert.equal(svc.kind, 'c');
  assert.equal(svc.st, 'service');
  assert.deepEqual(svc.ext, ['BaseService']);
  assert.deepEqual(svc.handed.map((p) => [p.name, p.type, p.inject]), [['_orders', 'OrderRepository', true], ['_mailer', 'IMailer', true], ['_logger', 'LoggerService', true]]);
  const field = (n) => svc.fields.find((f) => f.name === n);
  assert.equal(field('retries').vis, '-');
  assert.ok(field('KIND').flags.includes('s') && field('KIND').flags.includes('r'));
  assert.equal(field('_orders').type, 'OrderRepository', 'constructor parameter properties are fields');
  assert.deepEqual(svc.methods.map((m) => m.name), ['getOrder', 'createOrder', '_notify', '_format']);
  const create = svc.methods.find((m) => m.name === 'createOrder');
  assert.equal(create.vis, '+');
  assert.match(create.params, /^body: CreateOrderDto, options: /);
  assert.equal(create.ret, 'Promise<Order>');
  assert.deepEqual(create.calls.filter((c) => !c.key).map((c) => `${c.field}.${c.method}`), ['_orders.insert', 'null._notify', 'null._format']);
  assert.equal(svc.methods.find((m) => m.name === '_notify').vis, '-');
  assert.ok(!classesIn(SERVICE).some((c) => c.name === 'Ghost'), 'a class named in a comment or a string is not a class');
});

test('classes: interfaces, abstract classes, generics and decorators with type arguments', () => {
  const src = `export interface Repo<T extends { id: string }> extends Readable<T>, Closable {
  find(id: string): Promise<T | null>
  readonly name: string
}
@Entity()
export abstract class Base<T> implements Repo<T>, Closable {
  protected abstract table: string
  #secret = 1
  abstract find(id: string): Promise<T | null>
  static create<U>(x: U): Base<U> { return null as any }
  get size(): number { return 0 }
  handle = async (req: Request) => { await this.find(req.id) }
}`;
  const [iface, base] = classesIn(src);
  assert.equal(iface.kind, 'i');
  assert.deepEqual(iface.ifaceExt, ['Readable', 'Closable']);
  assert.deepEqual(iface.methods.map((m) => m.name), ['find']);
  assert.equal(base.kind, 'a');
  assert.deepEqual(base.imp, ['Repo', 'Closable']);
  assert.equal(base.st, 'model', 'a decorator names the kind before the class name does');
  assert.deepEqual(base.methods.map((m) => m.name), ['find', 'create', 'handle']);
  assert.ok(base.methods.find((m) => m.name === 'create').flags.includes('s'));
  assert.equal(base.fields.find((f) => f.name === '#secret').vis, '-');
  assert.equal(base.fields.find((f) => f.name === 'table').vis, '#');
  assert.ok(base.fields.find((f) => f.name === 'size').flags.includes('g'));
});

test('Prisma: columns, keys, table and schema names, and each kind of relation', () => {
  const { models, enums } = prismaModels(PRISMA);
  assert.deepEqual(models.map((m) => m.name), ['Order', 'OrderItem', 'Customer', 'Receipt', 'Tag']);
  assert.ok(enums.has('Status'));
  const order = models[0];
  assert.equal(order.table, 'orders');
  assert.equal(order.group, 'sales');
  assert.ok(order.columns.find((c) => c.name === 'id').pk);
  assert.ok(order.columns.find((c) => c.name === 'note').opt);
  assert.deepEqual(order.columns.find((c) => c.name === 'customer').fks, ['customer_id']);
  assert.deepEqual(models[1].columns.filter((c) => c.pk).map((c) => c.name), ['order_id', 'sku'], 'a composite key marks each of its columns');
});

test('Drizzle: tables, column types, keys and references', () => {
  const [clubs, players] = drizzleTables(DRIZZLE);
  assert.equal(clubs.name, 'clubs');
  assert.equal(players.table, 'players');
  assert.deepEqual(players.columns.map((c) => [c.name, c.column, c.type]), [['id', 'id', 'uuid'], ['clubId', 'club_id', 'uuid'], ['nickname', 'nickname', 'text'], ['number', 'shirt_number', 'integer']]);
  assert.ok(players.columns[0].pk && !players.columns[0].opt);
  assert.ok(players.columns[2].opt);
  assert.deepEqual(players.refs, [{ col: 'clubId', to: 'clubs', toCol: 'id', one: false, opt: false }]);
  assert.deepEqual(drizzleTables(DRIZZLE.replace('drizzle-orm/pg-core', 'some-orm')), [], 'only files that import drizzle-orm are read');
});

test('tsoa: endpoints from @Route and the verb decorators, the handler found past multi-line and generic decorators', () => {
  const r = extract(CONTROLLER, 'typescript', 'src/orders/order.controller.ts');
  assert.deepEqual(r.routes.map((x) => `${x.method} ${x.path} ${x.handler}`), ['GET /orders/:orderId getOrder', 'POST /orders createOrder', 'GET /orders/health/ping ping']);
  assert.ok(r.routes.every((x) => x.framework === 'tsoa'));
  // a file with a @Route decorator that isn't tsoa's is left alone
  assert.equal(extract(CONTROLLER.replace("from 'tsoa'", "from 'other-lib'"), 'typescript', 'src/x.ts').routes?.length || 0, 0);
});

let root, graph;
before(() => {
  root = makeProject({
    'package.json': '{"name":"shop","dependencies":{"tsoa":"6","inversify":"6","@prisma/client":"5"}}',
    'src/orders/order.controller.ts': CONTROLLER,
    'src/orders/order.service.ts': SERVICE,
    'src/orders/order.repository.ts': REPOSITORY,
    'src/orders/mailer.port.ts': MAILER_PORT,
    'src/orders/mailer.ts': MAILER,
    'src/orders/prisma.provider.ts': "import { PrismaClient } from '@prisma/client'\nexport class PrismaProvider { public client = new PrismaClient() }\n",
    'src/orders/logger.service.ts': 'export class LoggerService { info(msg: string, meta?: unknown): void {} }\n',
    'src/orders/base.ts': 'export abstract class BaseService { protected now(): Date { return new Date() } }\n',
    'src/orders/order.service.test.ts': 'export class FakeMailer { send() {} }\n',
    'src/container.ts': CONTAINER,
    'src/routes/routes.ts': GENERATED,
    'src/index.ts': "import express from 'express'\nimport { RegisterRoutes } from './routes/routes'\nconst app = express()\nRegisterRoutes(app)\napp.listen(3000)\n",
    'prisma/schema.prisma': PRISMA,
    'db/schema.ts': DRIZZLE,
  }, { arch: { project: { name: 'Shop' }, audience: 'developers', nodes: [{ id: 'api', label: 'API', kind: 'service', paths: ['src/**'] }, { id: 'data', label: 'Data', kind: 'data', paths: ['prisma/**', 'db/**'] }] } });
  scanAndBuild(root);
  graph = readGraph(root);
});
after(() => cleanup(root));

test('tsoa: the generated routes file hands its full addresses to the controller and leaves the map', () => {
  assert.deepEqual(routeKeys(graph), ['GET /api/v1/orders/:orderId', 'GET /api/v1/orders/health/ping', 'POST /api/v1/orders']);
  for (const r of graph.routes) assert.equal(r.f, 'src/orders/order.controller.ts', `${r.m} ${r.p} sits in the controller`);
  assert.equal(graph.routes.find((r) => r.m === 'POST').h, 'createOrder');
});

test('tsoa: Health reads @Security as a sign-in check and @NoSecurity as open', () => {
  assert.deepEqual(openEndpoints(graph).filter((k) => /orders\/?$|orderId/.test(k)), [], 'endpoints behind @Security are not reported');
});

test('Prisma and Solidity files are code, so the schema is on the map', () => {
  assert.ok(graph.files.some((f) => f.p === 'prisma/schema.prisma' && f.l === 'prisma'));
});

test('the built model: classes linked by inheritance, injection and bindings; test files left out', () => {
  const U = graph.uml;
  const idx = (n) => U.classes.findIndex((c) => c.n === n);
  const cls = (n) => U.classes[idx(n)];
  assert.ok(idx('FakeMailer') < 0, 'classes in test files are left out');
  assert.ok(idx('OrderDto') < 0, 'an interface nothing implements or is handed is left out');
  assert.equal(cls('IMailer').k, 'i');
  assert.deepEqual(cls('SesMailer').im, [idx('IMailer')]);
  assert.deepEqual(cls('OrderService').x, [idx('BaseService')]);
  assert.equal(cls('MailError').st, 'error');
  assert.deepEqual(cls('OrderService').d.map(([name, t, how]) => [name, U.classes[t].n, how]), [['_orders', 'OrderRepository', 'i'], ['_mailer', 'IMailer', 'i'], ['_logger', 'LoggerService', 'i']]);
  assert.deepEqual(U.binds, [[idx('IMailer'), idx('SesMailer')]]);
  assert.deepEqual(U.counts, { classes: U.classes.filter((c) => c.k !== 'i').length, interfaces: 1, entities: 7 });
});

test('the built model: calls resolve to classes and tables, and logging is left out', () => {
  const U = graph.uml;
  const idx = (n) => U.classes.findIndex((c) => c.n === n);
  const calls = (c, m) => (U.classes[idx(c)].m.find((x) => x[1] === m)[6] || []).map((x) => (x[0] >= 0 ? `${U.classes[x[0]].n}.${x[1]}` : x[0] === -2 ? `db ${x[2]} ${U.entities[x[1]].n}` : x[0] === -3 ? `outside ${x[1]}.${x[2]}` : `self ${x[1]}`));
  assert.deepEqual(calls('OrderController', 'createOrder'), ['OrderService.createOrder']);
  assert.deepEqual(calls('OrderService', 'getOrder'), ['OrderRepository.findById'], 'the logger call is not part of the story');
  assert.deepEqual(calls('OrderService', 'createOrder'), ['OrderRepository.insert', 'self _notify', 'self _format']);
  assert.deepEqual(calls('OrderService', '_notify'), ['IMailer.send']);
  assert.deepEqual(calls('OrderRepository', 'insert'), ['db createMany OrderItem', 'db create Order']);
});

test('the built model: the data model with keys, and one-to-many, one-to-one and many-to-many relations', () => {
  const U = graph.uml;
  const e = (n) => U.entities.findIndex((x) => x.n === n);
  const rel = (a, b) => U.rels.find((r) => r[0] === e(a) && r[1] === e(b));
  assert.deepEqual(U.entities[e('Order')].c, [['id', 'String', 'p'], ['customer_id', 'String', 'f'], ['note', 'String', 'n']], 'relation fields are relations, not columns');
  assert.equal(U.entities[e('Order')].t, 'orders');
  assert.equal(rel('Order', 'Customer')[2], 'n1');
  assert.equal(rel('OrderItem', 'Order')[2], 'n1');
  assert.equal(rel('Receipt', 'Order')[2], '11');
  assert.ok(U.rels.some((r) => r[2] === 'nn' && [r[0], r[1]].sort().join() === [e('Order'), e('Tag')].sort().join()));
  assert.deepEqual(rel('players', 'clubs').slice(2), ['n1', 'clubId', 0]);
  assert.deepEqual(U.entities[e('players')].c[1], ['clubId', 'uuid', 'f']);
});

test('nothing from a string or a comment reaches the model', () => {
  const root2 = makeProject({
    'src/keys.ts': "export class Keys {\n  // token = 'abc'\n  private token: string = 'SUPER-SECRET-VALUE'\n  call(url = 'https://internal.example/hook?key=SUPER-SECRET-VALUE'): void {}\n}\n",
  }, { arch: { project: { name: 'K' }, nodes: [{ id: 'a', label: 'A', kind: 'service', paths: ['src/**'] }] } });
  try {
    scanAndBuild(root2);
    const text = JSON.stringify(readGraph(root2).uml);
    assert.ok(text.includes('"Keys"'));
    assert.ok(!text.includes('SUPER-SECRET-VALUE') && !text.includes('internal.example'));
  } finally { cleanup(root2); }
});

test('a project with no classes and no schema gets no UML model, and its map still builds', () => {
  const root2 = makeProject({ 'src/a.js': 'export const a = 1;\n' }, { arch: { project: { name: 'P' }, nodes: [{ id: 'a', label: 'A', kind: 'service', paths: ['src/**'] }] } });
  try {
    scanAndBuild(root2);
    assert.equal(readGraph(root2).uml, undefined);
  } finally { cleanup(root2); }
});

test('the UML lens loads on a built map, offers its button, and leaves a map without a model alone', () => {
  const code = fs.readFileSync(path.join(SKILL, 'assets', 'ui', '35-uml.js'), 'utf8');
  const stub = (g) => {
    const buttons = [], sections = [];
    const node = () => new Proxy(function () {}, { get: (t, k) => (k === 'style' || k === 'dataset' || k === 'classList' ? node() : k === Symbol.toPrimitive ? () => '' : node()), set: () => true, apply: () => node() });
    const ctx = {
      window: { addEventListener() {}, Floorplan: { graph: g, h: String, hk: String, state: {}, exists: () => false, addHeaderButton: (b) => { buttons.push(b); return node(); }, addPanelSection: (w, fn) => sections.push([w, fn]) } },
      document: { createElement: () => node(), head: node(), body: node(), documentElement: node() },
      getComputedStyle: () => ({ getPropertyValue: () => '' }), MutationObserver: class { observe() {} },
    };
    vm.runInNewContext(code, ctx);
    return { buttons, sections, api: ctx.window.FloorplanUml };
  };
  const on = stub(graph);
  assert.deepEqual(on.buttons.map((b) => b.label), ['UML']);
  assert.equal(on.api.classes.length, graph.uml.classes.length);
  // the details panel offers a class diagram for a file with classes, a sequence diagram for an endpoint
  const item = on.sections.find(([w]) => w === 'item')[1];
  assert.match(item('f:src/orders/order.service.ts').html, /Class diagram/);
  assert.match(item(`r:${graph.routes.findIndex((r) => r.h === 'createOrder')}`).html, /Sequence diagram/);
  assert.match(item('f:prisma/schema.prisma').html, /Data model/);
  assert.equal(item('f:src/index.ts'), null);
  const off = stub({ ...graph, uml: undefined, flows: [] });
  assert.deepEqual(off.buttons, []);
});
