-- รับเงิน PromptPay ส่วนแรก: ตาราง payments (briefs/payment.md)
-- เขียนได้เฉพาะฟังก์ชันฝั่งเซิร์ฟเวอร์ (service_role) · ลูกค้าอ่านได้เฉพาะของออเดอร์ตัวเอง

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.shop_orders (id),
  provider text not null default 'stripe',
  provider_ref text not null unique,
  amount int not null check (amount >= 0), -- บาท
  status text not null default 'created' check (status in ('created', 'succeeded', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.payments enable row level security;

revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

create policy "ผู้ใช้อ่านการจ่ายของออเดอร์ตัวเอง" on public.payments for select to authenticated
  using (exists (select 1 from public.shop_orders o where o.id = order_id and o.user_id = auth.uid()));
