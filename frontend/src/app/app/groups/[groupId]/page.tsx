import ClientPage from './page-client';

export async function generateStaticParams() {
  return [{ groupId: '_' }];
}

export default function Wrapper() {
  return <ClientPage />;
}
