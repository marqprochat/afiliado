import { redirect } from 'next/navigation';

export default function AmazonConfigRedirect() {
  redirect('/marketplaces?open=AMAZON');
}
