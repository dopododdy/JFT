# JFT — แผนผังครอบครัวจวงพลงาม

## การตั้งค่าฐานข้อมูล Supabase (Full SQL)

### ขั้นตอนที่ 1 — สร้างตาราง `profiles` (ถ้ายังไม่มี)

```sql
create table if not exists profiles (
  id                uuid         primary key default gen_random_uuid(),
  prefix            text,
  first_name        text         not null,
  last_name         text,
  former_first_name text,
  former_last_name  text,
  gender            text,
  birth_date        date,
  marital_status    text         not null default 'โสด',
  is_alive          boolean      not null default true,
  death_date        date,
  phone             text,
  workplace         text,
  address           text,
  line_id           text,
  parent_id         uuid         references profiles(id),
  bio               text,
  created_at        timestamptz  not null default now()
);
```

### ขั้นตอนที่ 2 — เพิ่มคอลัมน์ใหม่ (สำหรับตาราง `profiles` ที่มีอยู่แล้ว)

> หากสร้างตาราง `profiles` ใหม่ในขั้นตอนที่ 1 แล้ว **ข้ามขั้นตอนนี้ได้เลย**

```sql
alter table profiles add column if not exists prefix            text;
alter table profiles add column if not exists former_first_name text;
alter table profiles add column if not exists former_last_name  text;
alter table profiles add column if not exists marital_status    text default 'โสด';
alter table profiles add column if not exists is_alive          boolean default true;
alter table profiles add column if not exists death_date        date;
alter table profiles add column if not exists phone             text;
alter table profiles add column if not exists workplace         text;
alter table profiles add column if not exists address           text;
alter table profiles add column if not exists line_id           text;
```

### ขั้นตอนที่ 3 — สร้าง (หรือสร้างใหม่) ตาราง `relationships`

> ตาราง `relationships` จำเป็นต้องมีคอลัมน์ **`from_id`** และ **`to_id`**
> หากเคยสร้างตารางไว้แล้วด้วยชื่อคอลัมน์ที่ต่างออกไป ให้รันคำสั่งด้านล่างเพื่อสร้างใหม่

```sql
-- ลบตารางเดิม (ถ้ามี) แล้วสร้างใหม่ให้ถูกต้อง
drop table if exists relationships;

create table relationships (
  id         uuid        primary key default gen_random_uuid(),
  from_id    uuid        not null references profiles(id) on delete cascade,
  to_id      uuid        not null references profiles(id) on delete cascade,
  relation   text        not null,
  created_at timestamptz not null default now()
);
```

---

### สรุปโครงสร้างตารางทั้งหมด

| ตาราง | คอลัมน์หลัก |
|---|---|
| `profiles` | `id`, `prefix`, `first_name`, `last_name`, `former_first_name`, `former_last_name`, `gender`, `birth_date`, `marital_status`, `is_alive`, `death_date`, `phone`, `workplace`, `address`, `line_id`, `parent_id`, `bio`, `created_at` |
| `relationships` | `id`, `from_id`, `to_id`, `relation`, `created_at` |

> **หมายเหตุ:** หากไม่สร้างตาราง `relationships` ฟีเจอร์การเชื่อมความสัมพันธ์ประเภท "พี่", "น้อง", "สามี/ภรรยา" จะไม่สามารถบันทึกข้อมูลได้ แต่ระบบยังคงใช้งานได้สำหรับความสัมพันธ์ประเภท "พ่อ", "แม่", และ "ลูก" (ซึ่งใช้ฟิลด์ `parent_id`)
