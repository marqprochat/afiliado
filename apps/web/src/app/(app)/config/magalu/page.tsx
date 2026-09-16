import { redirect } from 'next/navigation';

export default function MagaluConfigRedirect() {
  redirect('/marketplaces?open=MAGALU');
}
