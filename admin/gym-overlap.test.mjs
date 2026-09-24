import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB_INIT_GYM_BOOKINGS, DB_INIT_GYM_OVERLAP_TRIGGERS } from './db.js';
import { isGymOverlap } from './gym.js';
test('database excludes partial overlaps on insert, move, and reactivation; preserves history', () => {
  const db = new DatabaseSync(':memory:'); db.exec(DB_INIT_GYM_BOOKINGS);
  const add = (start, end, status = 'confirmed', date = '2026-10-01') => db.prepare('INSERT INTO gym_bookings(group_id,booking_date,start_time,end_time,status) VALUES(1,?,?,?,?)').run(date,start,end,status);
  add('13:00','15:00');
  for (const sql of DB_INIT_GYM_OVERLAP_TRIGGERS) db.exec(sql);
  // Both callers could have passed their preflight before these serialized writes.
  for (const [start,end] of [['14:00','16:00'],['12:00','14:00'],['12:00','16:00'],['13:30','14:30']]) {
    assert.throws(() => add(start,end), isGymOverlap);
  }
  add('15:00','16:00','hold'); add('12:00','13:00'); add('13:00','15:00','released'); add('13:00','15:00','confirmed','2026-10-02');
  assert.throws(() => db.exec("UPDATE gym_bookings SET status='confirmed' WHERE status='released'"), isGymOverlap);
  assert.throws(() => db.exec("UPDATE gym_bookings SET start_time='14:00' WHERE start_time='15:00'"), isGymOverlap);
  db.exec("UPDATE gym_bookings SET status='confirmed' WHERE status='hold'");
  db.exec("UPDATE gym_bookings SET status='released' WHERE start_time='13:00'");
  add('13:00','15:00');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM gym_bookings').get().n, 6);
});
test('installation never deletes existing overlaps and allows unrelated edits', () => {
  const db = new DatabaseSync(':memory:'); db.exec(DB_INIT_GYM_BOOKINGS);
  db.exec("INSERT INTO gym_bookings(group_id,booking_date,start_time,end_time) VALUES(1,'2026-10-01','13:00','15:00'),(2,'2026-10-01','14:00','16:00')");
  for (const sql of DB_INIT_GYM_OVERLAP_TRIGGERS) db.exec(sql);
  db.exec("UPDATE gym_bookings SET notes='review existing conflict'");
  assert.equal(db.prepare('SELECT COUNT(*) n FROM gym_bookings').get().n, 2);
});
