
import { PostgresMock } from '../dist/main.cjs'
import * as pg from "pg";

it('should work', async () => {
    const mock = await PostgresMock.create();
    const client = new pg.Client(mock.getNodePostgresConfig());

    await client.connect();
    
    expect(await client.query('SELECT $1::text as message', ['Hello world!'])).toMatchObject({ rows: [{ message: 'Hello world!' }] });

    await client.end();
})
