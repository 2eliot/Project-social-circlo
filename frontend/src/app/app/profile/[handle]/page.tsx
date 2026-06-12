import ClientPage from './page-client';

export async function generateStaticParams() {
  return [{ handle: '_' }];
}

export default function Wrapper() {
  return <ClientPage />;
}
