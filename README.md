# JFT — แผนผังครอบครัวจวงพลงาม

## การตั้งค่าฐานข้อมูล Supabase

### ตาราง `profiles` (มีอยู่แล้ว)
```sql
create table profiles (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  gender text,
  birth_date date,
  parent_id uuid references profiles(id),
  bio text,
  created_at timestamptz default now()
);
```

### ตาราง `relationships` (ต้องสร้างเพิ่มเติมสำหรับความสัมพันธ์ประเภท พี่/น้อง/สามี/ภรรยา)
```sql
create table relationships (
  id uuid primary key default gen_random_uuid(),
  from_id uuid references profiles(id) on delete cascade,
  to_id uuid references profiles(id) on delete cascade,
  relation text not null,
  created_at timestamptz default now()
);
```

> **หมายเหตุ:** หากไม่สร้างตาราง `relationships` ฟีเจอร์การเชื่อมความสัมพันธ์ประเภท "พี่", "น้อง", "สามี/ภรรยา" จะไม่สามารถบันทึกข้อมูลได้ แต่ระบบยังคงใช้งานได้สำหรับความสัมพันธ์ประเภท "พ่อ", "แม่", และ "ลูก" (ซึ่งใช้ฟิลด์ `parent_id`)
