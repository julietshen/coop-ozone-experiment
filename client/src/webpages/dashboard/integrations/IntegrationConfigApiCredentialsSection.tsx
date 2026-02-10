import { Input } from 'antd';

import {
  GQLGoogleContentSafetyApiIntegrationApiCredential,
  GQLIntegration,
  GQLIntegrationApiCredential,
  GQLOpenAiIntegrationApiCredential,
  GQLOzoneIntegrationApiCredential,
} from '../../../graphql/generated';

export default function IntegrationConfigApiCredentialsSection(props: {
  name: GQLIntegration;
  setApiCredential: (cred: GQLIntegrationApiCredential) => void;
  apiCredential: GQLIntegrationApiCredential;
}) {
  const { setApiCredential, apiCredential } = props;

  const renderGoogleContentSafetyApiCredential = (
    apiCredential: GQLGoogleContentSafetyApiIntegrationApiCredential,
  ) => {
    return (
      <div className="flex flex-col w-1/2">
        <div className="mb-1">API Key</div>
        <Input
          value={apiCredential.apiKey}
          onChange={(event) =>
            setApiCredential({
              ...apiCredential,
              apiKey: event.target.value,
            })
          }
        />
      </div>
    );
  };

  const renderOpenAiCredential = (
    apiCredential: GQLOpenAiIntegrationApiCredential,
  ) => {
    return (
      <div className="flex flex-col w-1/2">
        <div className="mb-1">API Key</div>
        <Input
          value={apiCredential.apiKey}
          onChange={(event) =>
            setApiCredential({
              ...apiCredential,
              apiKey: event.target.value,
            })
          }
        />
      </div>
    );
  };

  const renderOzoneCredential = (
    apiCredential: GQLOzoneIntegrationApiCredential,
  ) => {
    return (
      <div className="flex flex-col w-1/2 gap-4">
        <div className="flex flex-col">
          <div className="mb-1">DID</div>
          <Input
            value={apiCredential.did}
            placeholder="did:plc:..."
            onChange={(event) =>
              setApiCredential({
                ...apiCredential,
                did: event.target.value,
              })
            }
          />
        </div>
        <div className="flex flex-col">
          <div className="mb-1">Service URL</div>
          <Input
            value={apiCredential.serviceUrl}
            placeholder="https://ozone.example.com"
            onChange={(event) =>
              setApiCredential({
                ...apiCredential,
                serviceUrl: event.target.value,
              })
            }
          />
        </div>
        <div className="flex flex-col">
          <div className="mb-1">Handle (optional)</div>
          <Input
            value={apiCredential.handle ?? ''}
            placeholder="your-handle.bsky.social"
            onChange={(event) =>
              setApiCredential({
                ...apiCredential,
                handle: event.target.value || undefined,
              })
            }
          />
        </div>
      </div>
    );
  };

  const projectKeysInput = () => {
    switch (apiCredential.__typename) {
      case 'GoogleContentSafetyApiIntegrationApiCredential':
        return renderGoogleContentSafetyApiCredential(apiCredential);
      case 'OpenAiIntegrationApiCredential':
        return renderOpenAiCredential(apiCredential);
      case 'OzoneIntegrationApiCredential':
        return renderOzoneCredential(apiCredential);
      default:
        throw new Error('Integration not implemented yet');
    }
  };

  return <div className="flex flex-col pb-4">{projectKeysInput()}</div>;
}
