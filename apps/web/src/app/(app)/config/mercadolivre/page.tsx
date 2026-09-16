import { redirect } from 'next/navigation';

export default function MercadoLivreConfigRedirect() {
  redirect('/marketplaces?open=MERCADOLIVRE');
}
