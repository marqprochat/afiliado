import { redirect } from 'next/navigation';

export default function ShopeeConfigRedirect() {
  redirect('/marketplaces?open=SHOPEE');
}
